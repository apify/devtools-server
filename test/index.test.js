const puppeteer = require('puppeteer');

const DevToolsServer = require('../src/index');

const CONTAINER_HOST = 'localhost:4321';

process.on('unhandledRejection', (err) => { throw err; });

async function main() {
    console.log('Launching debuggable browser.');
    const debuggableBrowser = await puppeteer.launch({
        headless: true,
        args: ['--remote-debugging-port=9222'],
    });
    const debuggablePage = await debuggableBrowser.newPage();
    const client = await debuggablePage.target().createCDPSession();

    console.log('Enabling debugger.');
    await client.send('Debugger.enable');

    console.log('Opening example.com.');
    await debuggablePage.goto('https://example.com');

    const server = new DevToolsServer({
        containerHost: CONTAINER_HOST,
        devToolsServerPort: 4321,
        insecureConnection: true,
    });

    await server.start();

    const clientBrowser = await puppeteer.launch({
        headless: true,
    });

    const page = await clientBrowser.newPage();
    await page.goto(`http://${CONTAINER_HOST}`);
    const [, devTools] = await page.frames();

    // If this throws, the test failed.
    await devTools.waitForSelector('canvas', { timeout: 3000 });

    server.stop();
    await Promise.all([
        clientBrowser.close(),
        debuggableBrowser.close(),
    ]);

    console.log('SUCCESS');
}

main();
