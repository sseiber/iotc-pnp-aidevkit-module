import { inject, RoutePlugin, route } from '@sseiber/sprightly';
import { Request, ResponseToolkit } from 'hapi';
import { CameraService } from '../services/camera';
import * as Boom from 'boom';
import * as _get from 'lodash.get';

export class PeabodyRoutes extends RoutePlugin {
    @inject('camera')
    private camera: CameraService;

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
            await this.camera.login();

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
    public async postLogout(request: Request, h: ResponseToolkit) {
        try {
            await this.camera.logout();

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
            await this.camera.resetCameraServices();

            return h.response().code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/peabody/preview',
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
    public async postPreview(request: Request, h: ResponseToolkit) {
        try {
            const switchStatus = _get(request, 'payload.switchStatus');

            await this.camera.togglePreview(switchStatus);

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
            description: 'Get configuration current values and selection options'
        }
    })
    // @ts-ignore (request)
    public async getConfiguration(request: Request, h: ResponseToolkit) {
        try {
            const result = await this.camera.getConfiguration();

            return h.response(result).code(200);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }
}
