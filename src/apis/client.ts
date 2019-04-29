import { inject, RoutePlugin, route } from 'spryly';
import { Request, ResponseToolkit } from '@hapi/hapi';
import { CameraService } from '../services/camera';
import * as Boom from '@hapi/boom';
import * as _get from 'lodash.get';

export class ClientRoutes extends RoutePlugin {
    @inject('camera')
    private camera: CameraService;

    @route({
        method: 'POST',
        path: '/api/v1/client/session',
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
    public async postCreateSession(request: Request, h: ResponseToolkit) {
        try {
            const result = await this.camera.createCameraSession();

            return h.response(result).code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'DELETE',
        path: '/api/v1/client/session',
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
    public async postDestroySession(request: Request, h: ResponseToolkit) {
        try {
            const result = await this.camera.destroyCameraSession();

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
    public async postSwitchVisionAiModel(request: Request, h: ResponseToolkit) {
        try {
            const file = (request.payload as any).model;
            if (!file) {
                throw Boom.badRequest('No file descriptor found in the form data request');
            }

            const result = await this.camera.switchVisionAiModel({
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

    @route({
        method: 'POST',
        path: '/api/v1/client/reset',
        options: {
            auth: {
                strategies: ['client-jwt', 'client-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['client'],
            description: 'Reset the VAM engine or the device'
        }
    })
    // @ts-ignore (request)
    public async postResetDevice(request: Request, h: ResponseToolkit) {
        try {
            const resetAction = _get(request, 'payload.action');
            if (resetAction !== 'VAM' && resetAction !== 'DEVICE') {
                return {
                    status: false,
                    title: 'Camera',
                    message: 'An error occurred trying to complete the request to reset the device.'
                };
            }

            const result = await this.camera.resetDevice(resetAction);

            return h.response(result).code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }
}
