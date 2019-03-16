import { HapiPlugin, inject } from '@sseiber/sprightly';
import { Server } from 'hapi';
import { LoggingService } from '../services/logging';
import { AuthService } from '../services/auth';
import * as HapiAuthJwt from 'hapi-auth-jwt2';
import * as LocalNetworkAuthPlugin from './localNetworkAuth';

export class AuthPlugin implements HapiPlugin {
    @inject('logger')
    private logger: LoggingService;

    @inject('auth')
    private auth: AuthService;

    public async register(server: Server) {
        try {
            await server.register([HapiAuthJwt, LocalNetworkAuthPlugin]);

            server.auth.strategy(
                'peabody-jwt',
                'jwt',
                {
                    key: this.auth.secret,
                    validate: this.auth.validateRequest.bind(this.auth),
                    verifyOptions: { issuer: this.auth.issuer }
                });

            server.auth.strategy(
                'peabody-localnetwork',
                'localnetwork'
            );
        }
        catch (error) {
            this.logger.log(['AuthPlugin', 'error'], 'Failed to register auth strategies');
        }
    }
}
