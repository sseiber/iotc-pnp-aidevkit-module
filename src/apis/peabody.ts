import { inject, RoutePlugin, route } from '@sseiber/sprightly';
import { Request, ResponseToolkit } from 'hapi';
import { PeabodyService } from '../services/peabody';
import * as Boom from 'boom';

export class PeabodyRoutes extends RoutePlugin {
    @inject('peabody')
    private peabody: PeabodyService;

    @route({
        method: 'POST',
        path: '/api/v1/peabody/login',
        options: {
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['peabody'],
            description: 'Log into Peabody and get session'
        }
    })
    // @ts-ignore (request)
    public async postLogin(request: Request, h: ResponseToolkit) {
        try {
            await this.peabody.login();

            return h.response().code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/peabody/logout',
        options: {
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['peabody'],
            description: 'Log out of current Peabody session'
        }
    })
    // @ts-ignore (request)
    public async postLogin(request: Request, h: ResponseToolkit) {
        try {
            await this.peabody.logout();

            return h.response().code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/peabody/reset',
        options: {
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['peabody'],
            description: 'Reset peabody system services (implied logout)'
        }
    })
    // @ts-ignore (request)
    public async postReset(request: Request, h: ResponseToolkit) {
        try {
            await this.peabody.reset();

            return h.response().code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'GET',
        path: '/api/v1/peabody/configuration',
        options: {
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['peabody'],
            description: 'Get configuration - login as a side affect'
        }
    })
    // @ts-ignore (request)
    public async getConfiguration(request: Request, h: ResponseToolkit) {
        try {
            const result = await this.peabody.getConfigurationValues();

            return h.response(result.body).code(200);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/peabody',
        options: {
            auth: {
                strategies: ['peabody-jwt'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['api'],
            description: 'Test api 2'
        }
    })
    public async postTest2(request: Request, h: ResponseToolkit) {
        const result: any = await this.peabody.handleTest2();

        if (!result.completed) {
            throw Boom.badRequest(result.body ? result.body.message : null);
        }

        return h.response(result.body).code(201);
    }
}
