import { HapiPlugin, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { LoggingService } from '../services/logging';
import { ConfigService } from '../services/config';
import { StateService } from '../services/state';
import { ClientProxyService } from '../services/clientProxy';
import { Client as NesClient } from '@hapi/nes';
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

export class ClientProxyPlugin implements HapiPlugin {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    @inject('config')
    private config: ConfigService;

    @inject('state')
    private state: StateService;

    @inject('clientProxy')
    private clientProxy: ClientProxyService;

    private registrationHooks;
    private nesClient;

    // @ts-ignore (server, options)
    public async register(server: Server, options: any) {
        this.logger.log(['ClientProxyPlugin', 'info'], 'registering local server instance with cloud service');

        this.registrationHooks = [];
        this.nesClient = new NesClient(this.config.get('clientProxyService_proxyWsEndPoint'));

        this.nesClient.onError = (nesError) => {
            this.logger.log(['ClientProxyPlugin', 'error'], `Nes error: ${nesError.message}`);
        };

        // @ts-ignore (willReconnect)
        this.nesClient.onDisconnect = (willReconnect, nesLog) => {
            this.logger.log(['ClientProxyPlugin', 'info'], `Nes disconnect: ${nesLog.explanation}`);
        };

        // tslint:disable-next-line:space-before-function-paren
        this.nesClient.onConnect = async () => {
            this.logger.log(['ClientProxyPlugin', 'info'], 'Nes connect: to Client remote host');

            // Send registration packet on every connection
            let registerClientResponse;
            let registerClientError;
            try {
                registerClientResponse = await this.nesClient.message({
                    type: 'registerClientId',
                    payload: {
                        clientId: this.state.system.systemId
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
                    this.logger.log(['ClientProxyPlugin', 'info'], `Received socket mapping response from server: ${_get(registerClientResponse, 'payload.message')}`);

                    return p1.resolve(registerClientResponse);
                }
            }
        };

        // tslint:disable-next-line:space-before-function-paren
        this.nesClient.onUpdate = async (message) => {
            this.logger.log(['ClientProxyPlugin', 'info'], `Proxy Nes update - path: ${message.path}`);

            await this.clientProxy.handleProxyRequest(message);
        };

        try {
            await this.clientProxy.registerPluginProxy(this.nesClient);

            await this.registerClientService();
        }
        catch (error) {
            this.logger.log(['ClientProxyPlugin', 'error'], `Error registering websocket: ${error.message}`);

            if ((this.server.settings.app as any).usePortal === false) {
                // running in serverless mode -- continue on
                return error;
            }

            // kill service since subscription is missing, let service restart
            throw error;
        }
    }

    private async registerClientService() {
        const p1 = new DeferredPromise();
        this.registrationHooks.push(p1);

        return Promise.all([
            p1,
            this.nesClient.connect()
        ]);
    }
}
