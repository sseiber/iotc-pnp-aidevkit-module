import { inject, RoutePlugin, route } from 'spryly';
import { Request, ResponseToolkit } from 'hapi';
import { CameraService } from '../services/camera';
import * as Boom from 'boom';
import * as _get from 'lodash.get';

export class ClientRoutes extends RoutePlugin {
    @inject('camera')
    private camera: CameraService;

    @route({
        method: 'POST',
        path: '/api/v1/client/login',
        options: {
            auth: {
                strategies: ['client-jwt', 'client-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['client'],
            description: 'Log into AI Dev Kit and get session'
        }
    })
    // @ts-ignore (request)
    public async postLogin(request: Request, h: ResponseToolkit) {
        try {
            const result = await this.camera.login();

            return h.response(result).code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/client/logout',
        options: {
            auth: {
                strategies: ['client-jwt', 'client-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['client'],
            description: 'Log out of current AI Dev Kit session'
        }
    })
    // @ts-ignore (request)
    public async postLogout(request: Request, h: ResponseToolkit) {
        try {
            const result = await this.camera.logout();

            return h.response(result).code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/client/camera',
        options: {
            auth: {
                strategies: ['client-jwt', 'client-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['client'],
            description: 'Configure camera settings'
        }
    })
    // @ts-ignore (request)
    public async postCamera(request: Request, h: ResponseToolkit) {
        try {
            const cameraSettings = _get(request, 'payload');

            await this.camera.setCameraSettings(cameraSettings);

            return h.response().code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/client/model',
        options: {
            payload: {
                output: 'stream',
                maxBytes: 1024 * 1024 * 100, // BAD! Need a streaming solution for HapiJS
                allow: 'multipart/form-data',
                parse: true
            },
            auth: {
                strategies: ['client-jwt', 'client-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['client'],
            description: 'Upload a new dlc model file and activate it'
        }
    })
    // @ts-ignore (request)
    public async postchangeVideoModel(request: Request, h: ResponseToolkit) {
        try {
            const file = (request.payload as any).model;
            if (!file) {
                throw Boom.badRequest('No file descriptor found in the form data request');
            }

            const result = await this.camera.changeVideoModel({
                type: 'multipart',
                file
            });

            return h.response(result).code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'GET',
        path: '/api/v1/client/configuration',
        options: {
            auth: {
                strategies: ['client-jwt', 'client-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['client'],
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
