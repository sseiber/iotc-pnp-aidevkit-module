import { service, inject } from 'spryly';
import { Request, ResponseToolkit } from '@hapi/hapi';
import { LoggingService } from './logging';
import { StorageService } from './storage';
import { StateService } from './state';
import { randomBytes as cryptoRandomBytes } from 'crypto';
import { sign as jwtSign } from 'jsonwebtoken';
import { v4 as uuidV4 } from 'uuid';

const SECRET_LENGTH = 64;

@service('auth')
export class AuthService {
    @inject('logger')
    private logger: LoggingService;

    @inject('storage')
    private storage: StorageService;

    @inject('state')
    private state: StateService;

    private secretInternal;
    private issuerInternal;

    public get secret() {
        return this.secretInternal;
    }

    public get issuer() {
        return this.issuerInternal;
    }

    public async init() {
        this.logger.log(['AuthService', 'info'], 'initialize');

        this.issuerInternal = this.state.system.systemId;
        if (!this.issuerInternal) {
            throw new Error('No system id defined');
        }

        const secret = await this.storage.get('auth', 'secret');

        if (secret && secret.length > 0) {
            this.secretInternal = Buffer.from(secret, 'base64');

            return;
        }

        return this.setup();
    }

    public async generateToken(scope) {
        const id = uuidV4();
        const arrayOfScope = Array.isArray(scope) ? scope : [scope];
        const payload = { scope: arrayOfScope, id };

        const options = {
            issuer: this.issuerInternal
        };

        const token = await jwtSign(payload, this.secretInternal, options);

        return { token, id };
    }

    // @ts-ignore (id)
    public async revokeToken(id) {
        // TODO: implement
        return;
    }

    // @ts-ignore (request, h)
    public async validateRequest(decoded, request: Request, h: ResponseToolkit) {
        // TODO: validate incoming request

        // Ensure there are ids and scopes
        if (!decoded.id || !decoded.scope || !Array.isArray(decoded.scope)) {
            return {
                isValid: false
            };
        }

        // Build the "profile", we really just need to copy the scopes over so hapi can later validate these
        return {
            isValid: true,
            credentials: { scope: decoded.scope }
        };
    }

    private async setup() {
        try {
            const secret = await this.generateSecret();

            await this.storage.set('auth', 'secret', secret);

            this.secretInternal = Buffer.from(secret, 'base64');
        }
        catch (ex) {
            this.logger.log(['AuthService', 'error'], ex.message);

            // eat exceptions
        }

        return;
    }

    private async generateSecret() {
        const res = await cryptoRandomBytes(SECRET_LENGTH);

        return res.toString('base64');
    }
}
