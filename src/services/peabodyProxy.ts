import { service, inject } from '@sseiber/sprightly';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import * as _defaults from 'lodash.defaults';
import * as request from 'request';

@service('peabodyProxy')
export class PeabodyProxyService {
    @inject('logger')
    private logger: LoggingService;

    @inject('config')
    private config: ConfigService;

    private nesClient;

    public async init() {
        this.logger.log(['PeabodyProxyService', 'info'], 'initialize');
    }

    public async registerPluginProxy(nesClient): Promise<void> {
        this.nesClient = nesClient;
    }

    public async updatePeabodyRegistration(peabodyId: string, systemName: string) {
        const response = await this.nesClient.message({
            type: 'updatePeabodyRegistration',
            payload: {
                peabodyId,
                systemName
            }
        });

        this.logger.log(['PeabodyProxyService', 'info'], response.message);
    }

    public async handleProxyRequest(requestData) {
        this.logger.log(['handleProxyRequest', 'info'], `Received proxy request from server - path: ${requestData.path}`);

        try {
            const internalRequestResponse = await this.peabodyInternalRequest(requestData);

            const resp = {
                type: 'proxyResponse',
                raw: internalRequestResponse ? internalRequestResponse.raw : false,
                payload: {
                    proxyRequestId: requestData.requestId
                }
            };

            if (internalRequestResponse.raw) {
                resp.payload = internalRequestResponse;
                resp.payload.proxyRequestId = requestData.requestId;
            }
            else {
                (resp.payload as any).intent = internalRequestResponse;
            }

            const clientMessageResponse = await this.nesClient.message(resp);

            this.logger.log(['handleProxyRequest', 'info'], `Done sending proxy response: ${clientMessageResponse.message || ''}`);
        }
        catch (error) {
            this.logger.log(['handleProxyRequest', 'error'], `Error responding back to proxy server: ${error.message}`);

        }
    }

    private async peabodyInternalRequest(requestData): Promise<any> {
        const options: any = {
            method: requestData.method,
            uri: this.config.get('peabodyProxyService_internalEndPoint') + requestData.path,
            headers: requestData.headers
        };

        if (requestData.raw) {
            options.encoding = null;
        }
        else {
            options.json = true;
            options.body = {};
        }

        if (requestData.auth) {
            if (requestData.auth.peabody) {
                options.headers = _defaults({ Authorization: requestData.auth.peabody }, options.headers || {});
            }

            if (requestData.auth.authorization) {
                options.body = _defaults({ auth: requestData.auth.authorization }, options.body);
            }
        }

        if (requestData.payload) {
            options.body = (requestData.raw)
                ? Buffer.from(requestData.payload, 'base64')
                : _defaults({ requestId: requestData.requestId }, requestData.payload, options.body);
        }
        else if (!requestData.raw) {
            options.body = {
                requestId: requestData.requestId,
                inputAdapterRequest: requestData.inputAdapterRequest
            };
        }

        return new Promise((resolve, reject) => {
            request(options, (requestError, response, body) => {
                if (requestError) {
                    this.logger.log(['PeabodyProxyService', 'error'], `peabodyInternalRequest: ${requestError.message}`);
                    return reject(requestError);
                }

                if (requestData.raw) {
                    const rawResponse = {
                        headers: response.headers,
                        body: response.body ? response.body.toString('base64') : null,
                        statusCode: response.statusCode,
                        raw: true
                    };

                    return resolve(rawResponse);
                }

                if (response.statusCode !== 201) {
                    this.logger.log(['PeabodyProxyService', 'error'], `Response status code = ${response.statusCode}`);

                    return reject({ message: body.message || body });
                }

                return resolve(body);
            });
        });
    }
}
