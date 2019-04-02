import { HapiPlugin, inject } from 'spryly';
import { Server } from 'hapi';
import { LoggingService } from '../services/logging';
import { ConfigService } from '../services/config';
import { StateService } from '../services/state';
import { PeabodyProxyService } from '../services/peabodyProxy';
import { Client as NesClient } from 'nes';
import * as _get from 'lodash.get';

class DeferredPromise {
    public then: any;
    public catch: any;
    public resolve: any;
    public reject: any;
    private promiseInternal: any;

    public constructor() {
        this.promiseInternal = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
        this.then = this.promiseInternal.then.bind(this.promiseInternal);
        this.catch = this.promiseInternal.catch.bind(this.promiseInternal);
    }

    public get promise() {
        return this.promiseInternal;
    }
}

export class PeabodyProxyPlugin implements HapiPlugin {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    @inject('config')
    private config: ConfigService;

    @inject('state')
    private state: StateService;

    @inject('peabodyProxy')
    private peabodyProxy: PeabodyProxyService;

    private registrationHooks;
    private nesClient;

    // @ts-ignore (server, options)
    public async register(server: Server, options: any) {
        this.logger.log(['PeabodyProxyPlugin', 'info'], 'registering local server instance with cloud service');

        this.registrationHooks = [];
        this.nesClient = new NesClient(this.config.get('peabodyProxyService_proxyWsEndPoint'));

        this.nesClient.onError = (nesError) => {
            this.logger.log(['PeabodyProxyPlugin', 'error'], `Nes error: ${nesError.message}`);
        };

        // @ts-ignore (willReconnect)
        this.nesClient.onDisconnect = (willReconnect, nesLog) => {
            this.logger.log(['PeabodyProxyPlugin', 'info'], `Nes disconnect: ${nesLog.explanation}`);
        };

        // tslint:disable-next-line:space-before-function-paren
        this.nesClient.onConnect = async () => {
            this.logger.log(['PeabodyProxyPlugin', 'info'], 'Nes connect: to Peabody remote host');

            // Send registration packet on every connection
            let registerClientResponse;
            let registerClientError;
            try {
                registerClientResponse = await this.nesClient.message({
                    type: 'registerPeabodyId',
                    payload: {
                        peabodyId: this.state.systemId
                    }
                });
            }
            catch (error) {
                registerClientError = error;
            }

            while (this.registrationHooks.length) {
                const p1 = this.registrationHooks.shift();

                if (registerClientError) {
                    return p1.reject(registerClientError);
                }
                else {
                    this.logger.log(['PeabodyProxyPlugin', 'info'], `Received socket mapping response from server: ${_get(registerClientResponse, 'payload.message')}`);

                    return p1.resolve(registerClientResponse);
                }
            }
        };

        // tslint:disable-next-line:space-before-function-paren
        this.nesClient.onUpdate = async (message) => {
            this.logger.log(['PeabodyProxyPlugin', 'info'], `Proxy Nes update - path: ${message.path}`);

            await this.peabodyProxy.handleProxyRequest(message);
        };

        try {
            await this.peabodyProxy.registerPluginProxy(this.nesClient);

            await this.registerPeabodyService();
        }
        catch (error) {
            this.logger.log(['PeabodyProxyPlugin', 'error'], `Error registering websocket: ${error.message}`);

            if ((this.server.settings.app as any).usePortal === false) {
                // running in serverless mode -- continue on
                return error;
            }

            // kill service since subscription is missing, let service restart
            throw error;
        }
    }

    private async registerPeabodyService() {
        const p1 = new DeferredPromise();
        this.registrationHooks.push(p1);

        return Promise.all([
            p1,
            this.nesClient.connect()
        ]);
    }
}
