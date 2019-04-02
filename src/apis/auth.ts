import { inject, RoutePlugin, route } from 'spryly';
import { Request, ResponseToolkit } from 'hapi';
import { AuthService } from '../services/auth';
import * as Boom from 'boom';

export class AuthRoutes extends RoutePlugin {
    @inject('auth')
    private auth: AuthService;

    @route({
        method: ['POST', 'GET'],
        path: '/api/v1/auth/generate',
        options: {
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                scope: ['admin']
            },
            tags: ['auth'],
            description: 'Generate tokens (Temporary)'
        }
    })
    public async generate(request: Request, h: ResponseToolkit) {
        const payload: any = request.payload;

        if (!payload.scope) {
            throw Boom.badRequest('Missing scope field in payload');
        }

        const tokenInfo = await this.auth.generateToken(payload.scope);

        return h.response(tokenInfo).code(201);
    }
}
