# devtools-server
Enables remote connection to DevTools of a Chrome browser running somewhere
on the internet, typically in a Docker container.

```

                         container at some-host.com
                   |------------------------------------|
 |--------|        |  |----------|        |----------|  |
 | client | <====> |  | devtools |        |  Chrome  |  |
 |--------|        |  |  server  | <====> | DevTools |  |
                   |  |----------|        |----------|  |
                   |------------------------------------|

```
The client can not connect to Chrome DevTools directly due to security
limitations of Chrome, which allows connections only from localhost.
devtools-server bridges that connection and serves as a proxy between
the client and the Chrome DevTools. Automatically forwarding connections
to the first open tab, ignoring about:blank.

## Example

```js
const server = new DevToolsServer({
    containerHost: 'some-host.com',
    devToolsServerPort: 4321,
});

await server.start();
```

Server will now accept connections at `https://some-host.com` and make DevTools frontend available there.

## Use with Puppeteer

```js
const DevToolsServer = require('devtools-server');
const puppeteer = require('puppeteer');

async function main() {
    const browser = await puppeteer.launch({
        args: ['--remote-debugging-port=9222'],
    });

    const server = new DevToolsServer({
        // Using localhost here so you can run
        // the example on your local machine.
        containerHost: 'localhost:4321',
        devToolsServerPort: 4321,
        insecureConnection: true,
    });

    await server.start();

    const page = await browser.newPage();
    await page.goto('https://example.com');

    // Now connect to the server. You will see the page
    // loaded and DevTools open.

    // This delay is only here to give you enough time to
    // connect and inspect the page. See debugging section
    // below for breakpoint use.
    await page.waitFor(2 * 60 * 1000);

    server.stop();
    await browser.close();
}

main();
```

### Debugging
Probably the most common use-case for DevTools is debugging. You can easily extend your scripts with debugging
capabilities by enabling the Debugger and adding breakpoints. 

```js
// page is a Puppeteer Page
const cdpClient = await page.target().createCDPSession();
await cdpClient.send('Debugger.enable');

// adding breakpoints later

// Stops execution in the browser,
// but this script will keep running.
await cdpClient.send('Debugger.pause');

// Stops execution in both browser
// and this script. Will not continue
// until the execution is resumed in browser.
await page.evaluate(() => { debugger; });
```

## Use with Apify

This library was created to be used with the [`Apify`](https://apify.com) platform
to enable its users viewing and debugging their scrapers directly in the application UI.

To access the containers running on the platform, one needs to utilize the CONTAINER_URL
and CONTAINER_PORT [environment variables](https://docs.apify.com/actor/run#environment-variables).
If you want a better understanding of this library, read
[how to run a web server](https://help.apify.com/en/articles/2157629-running-a-web-server).

```js
const browser = await Apify.launchPuppeteer({
    args: ['--remote-debugging-port=9222'],
})

const server = new DevToolsServer({
    containerHost: process.env.CONTAINER_URL,
    devToolsServerPort: process.env.CONTAINER_PORT,
});

await server.start();
```

Everything else is the same as in the [Puppeteer](#use-with-puppeteer) examples.

### Using with `PuppeteerCrawler`

Here it gets a bit tricky because the crawler will open and close pages on its own. Depending
on your use-case, you'll have to do one or all of those things:

- set `maxConcurrency` to `1` to only use a single tab. Otherwise it gets messy
- prevent retiring of browsers by setting `retireInstanceAfterRequestCount` high.
- increase `handlePageTimeoutSecs` to prevent timeouts killing your pages
- increase `gotoTimeoutSecs` if you use breakpoints before navigation
- add delays and timeouts inside the `handlePageFunction` to slow things down
  You can use `page.waitFor(millis)` to create a delay
- add breakpoints using `await page.evaluate(() => { debugger; })` to stop execution

#### Example constructor options 

```js
const puppeteerCrawlerOptions = {
    ...otherOptions, // such as requestQueue, handlePageFunction...
    maxConcurrency: 1,
    handlePageTimeoutSecs: 3600, // 1 hour
    gotoTimeoutSecs: 3600,
    launchPuppeteerOptions: {
        args: ['--remote-debugging-port=9222']
    },
    puppeteerPoolOptions: {
        retireInstanceAfterRequestCount: 10000
    }
}
```
