import { service, inject } from '@sseiber/sprightly';
import * as request from 'request';
import * as _get from 'lodash.get';
import * as crypto from 'crypto';
import { ConfigService } from './config';
import { LoggingService } from './logging';

const TIME_MINUTES: number = (1000 * 60);
const TIME_HOURS: number = (1000 * 60 * 60);

@service('iotCentral')
export class IoTCentralService {
    @inject('config')
    private config: ConfigService;

    @inject('logger')
    private logger: LoggingService;

    public async getConnectionString(deviceId: string, scopeId: string,  mkey: string) {
        const expiry = new Date(Date.now() - (TIME_MINUTES * 5) + (TIME_HOURS * Number(this.config.get('iotCentralExpiryHours'))));
        const deviceKey = this.computDerivedSymmetricKey(deviceId, mkey);
        const sr = `${scopeId}/registrations/${deviceId}`;
        const sig = this.computDerivedSymmetricKey(`${sr}\n${expiry.toISOString()}`, deviceKey);

        const options = {
            method: 'PUT',
            url: this.config.get('iotCentralDpsEndpoint').replace('###scopeId', scopeId).replace('###deviceId', deviceId),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json; charset=utf-8',
                'Connection': 'keep-alive',
                'UserAgent': 'prov_device_client/1.0',
                'Authorization': `SharedAccessSignature sr=${sr}&sig=${encodeURIComponent(sig)}&se=${expiry.toISOString()}&skn=registration`
            },
            body: {
                registrationId: deviceId
            }
        };

        const result = await this.iotcRequest(options);

        return result;
    }

    private computDerivedSymmetricKey(id: string, secret: string) {
        const secretBuffer = Buffer.from(secret, 'base64');
        const derivedSymmetricKey = crypto.createHmac('SHA256', secretBuffer).update(id, 'utf8').digest('base64');

        return derivedSymmetricKey;
    }

    private async iotcRequest(options: any) {
        return new Promise((resolve, reject) => {
            request(options, (requestError, response, body) => {
                if (requestError) {
                    this.logger.log(['IoTCentralService', 'error'], `_processInputRequest: ${requestError.message}`);
                    return reject(requestError);
                }

                if (response.statusCode < 200 || response.statusCode > 299) {
                    this.logger.log(['IoTCentralService', 'error'], `Response status code = ${response.statusCode}`);

                    const errorMessage = body.message || body || 'An error occurred';
                    return reject(new Error(`Error statusCode: ${response.statusCode}, ${errorMessage}`));
                }

                return resolve(body);
            });
        });
    }
}
