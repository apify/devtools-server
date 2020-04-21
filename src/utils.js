/**
 * Starts listening at the specified port.
 * Returns a function that calls `server.listen(port)` and resolves once server starts listening.
 *
 * Usage: `await promisifyServerListen(server)(1234)`;
 *
 * @param {Server} server
 * @return {function(port): Promise<void>}
 */
exports.promisifyServerListen = (server) => {
    return (port) => {
        return new Promise((resolve, reject) => {
            const onError = (err) => {
                removeListeners();
                reject(err);
            };

            const onListening = () => {
                removeListeners();
                resolve();
            };

            const removeListeners = () => {
                server.removeListener('error', onError);
                server.removeListener('listening', onListening);
            };

            server.on('error', onError);
            server.on('listening', onListening);
            server.listen(port);
        });
    };
};
