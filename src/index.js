const retry = require('async-retry');
const http = require('http');
const httpProxy = require('http-proxy');
const { createHttpTerminator } = require('http-terminator');
const get = require('simple-get');

const { renderHomePage } = require('./home-page');
const { promisifyServerListen } = require('./utils');

/**
 * Enables remote connection to DevTools of a browser running somewhere
 * on the internet, typically in a Docker container.
 *
 *                         container at some-host.com
 *                   |------------------------------------|
 * |--------|        |   |----------|        |----------| |
 * | client | <====> |   | devtools |        |  Chrome  | |
 * |--------|        |   |  server  | <====> | DevTools | |
 *                   |   |----------|        |----------| |
 *                   |------------------------------------|
 *
 * The client can not connect to Chrome DevTools directly due to security
 * limitations of Chrome, which allows connections only from localhost.
 * DevToolsServer bridges that connection and serves as a proxy between
 * the client and the Chrome DevTools. Automatically forwarding connections
 * to the first open tab, ignoring about:blank.
 */
class DevToolsServer {
    /**
     * @param {object} options
     * @param {string} options.containerHost
     *  Host of the machine where the DevToolsServer and Chrome are running.
     *  If you don't specify port, default protocol ports will be used.
     *  If the devToolsServerPort is public and you want to access it
     *  directly, add it to the host.
     * @param {number} options.devToolsServerPort
     *  Port that the DevToolsServer should listen on.
     * @param {number} [options.chromeRemoteDebuggingPort=9222]
     *  Set this to the --remote-debugging-port you launched Chrome with.
     * @param {number} [options.insecureConnection]
     *  Whether the DevTools connection should be made over encrypted protocols.
     *  Turn this off if your host does not accept secure connections.
     */
    constructor(options) {
        const {
            containerHost,
            devToolsServerPort,
            chromeRemoteDebuggingPort = 9222,
            insecureConnection = false,
        } = options;

        this.containerHost = containerHost;
        this.serverPort = devToolsServerPort;
        this.chromePort = chromeRemoteDebuggingPort;
        this.wsProtocol = insecureConnection ? 'ws' : 'wss';

        this.server = null;
        this.serverTerminator = null;
        this.proxy = null;
        this.proxyTerminator = null;
    }

    /**
     * Starts a server on the specified port that serves a very simple
     * page with DevTools frontend embedded in an iFrame on the root path
     * and proxies all other paths and websocket to the debugged browser.
     *
     * There are two main reasons for this. First, it allows skipping the
     * page selection screen and go directly to debugging. Second, it
     * enables additional UI features that are needed to control the
     * debugging process, such as refreshing page to load a new tab.
     *
     * @return {Promise<Server>}
     */
    async start() {
        console.log('devtools-server starting.');
        this.proxy = this._createProxy();
        this.proxyTerminator = createHttpTerminator({
            server: this.proxy,
        });
        this.server = this._createServer();
        this.serverTerminator = createHttpTerminator({
            server: this.server,
        });
        await promisifyServerListen(this.server)(this.serverPort);
        console.log(`devtools-server listening on port: ${this.serverPort}`);
    }

    /**
     * Closes the server and all open connections.
     */
    stop() {
        this.proxyTerminator.terminate();
        this.serverTerminator.terminate();
    }

    _createProxy() {
        const proxy = httpProxy.createProxyServer({
            target: {
                host: 'localhost',
                port: this.chromePort,
            },
        });
        proxy.on('proxyReq', (proxyReq) => {
            // We need Chrome to think that it's on localhost otherwise it throws an error...
            proxyReq.setHeader('Host', 'localhost');
        });
        proxy.on('error', (err) => {
            console.error('devtools-server:proxy:', err);
        });
        return proxy;
    }

    _createServer() {
        const server = http.createServer(async (req, res) => {
            if (req.url === '/') {
                try {
                    const debuggerUrl = await this.createDebuggerUrl();
                    res.writeHead(200);
                    res.end(renderHomePage(debuggerUrl));
                } catch (err) {
                    res.writeHead(500);
                    res.end(`Error: ${err.message}`);
                }
            } else {
                this.proxy.web(req, res);
            }
        });
        server.on('upgrade', (req, socket, head) => {
            this.proxy.ws(req, socket, head);
        });
        server.on('error', (err) => {
            console.error('devtools-server:', err);
        });
        return server;
    }

    parseVersionHash(versionData) {
        const version = versionData['WebKit-Version'];
        return version.match(/\s\(@(\b[0-9a-f]{5,40}\b)/)[1];
    }

    async createDebuggerUrl() {
        const [hash, devtoolsUrl] = await retry(this.fetchHashAndDevToolsUrl.bind(this), { retries: 0 });

        // http://localhost:9222/devtools/inspector.html?ws=localhost:9222/devtools/page/0BAC623431B93A0908551626AA14247D
        const correctDevtoolsUrl = devtoolsUrl.replace(`ws=localhost:${this.chromePort}`, `${this.wsProtocol}=${this.containerHost}`);
        return `https://chrome-devtools-frontend.appspot.com/serve_file/@${hash}/${correctDevtoolsUrl}&remoteFrontend=true`;
    }

    async fetchHashAndDevToolsUrl() {
        const [list, version] = await Promise.all([
            this.fetchDevToolsInfo('list'),
            this.fetchDevToolsInfo('version'),
        ]);
        const hash = this.parseVersionHash(version);
        const devtoolsFrontendUrl = this.findPageUrl(list);
        if (!devtoolsFrontendUrl) throw Error('Page not ready yet.');
        return [hash, devtoolsFrontendUrl];
    }

    async fetchDevToolsInfo(resource) {
        const opts = {
            url: `http://localhost:${this.chromePort}/json/${resource}`,
            json: true,
        };
        return new Promise((resolve, reject) => {
            get.concat(opts, (err, res, data) => {
                if (err) return reject(err);
                resolve(data);
            });
        });
    }

    findPageUrl(list) {
        const page = list.find(p => p.type === 'page' && p.url !== 'about:blank');
        return page && page.devtoolsFrontendUrl.replace(/^\/devtools\//, '');
    }
}

module.exports = DevToolsServer;
