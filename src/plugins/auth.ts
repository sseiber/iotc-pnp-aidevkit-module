import { HapiPlugin, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { LoggingService } from '../services/logging';
import { AuthService } from '../services/auth';
import * as HapiAuthJwt from 'hapi-auth-jwt2';
import { LocalNetworkAuthPlugin } from './localNetworkAuth';

export class AuthPlugin implements HapiPlugin {
    @inject('logger')
    private logger: LoggingService;

    @inject('auth')
    private auth: AuthService;

    public async register(server: Server) {
        try {
            await server.register([ HapiAuthJwt, LocalNetworkAuthPlugin ]);

            server.auth.strategy(
                'client-jwt',
                'jwt',
                {
                    key: this.auth.secret,
                    validate: this.auth.validateRequest.bind(this.auth),
                    verifyOptions: { issuer: this.auth.issuer }
                });

            server.auth.strategy(
                'client-localnetwork',
                'localnetwork'
            );
        }
        catch (error) {
            this.logger.log(['AuthPlugin', 'error'], 'Failed to register auth strategies');
        }
    }
}
