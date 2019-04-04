import { inject, RoutePlugin, route } from 'spryly';
import { Request, ResponseToolkit } from 'hapi';
import { CameraService } from '../services/camera';
import { IoTCentralService } from '../services/iotcentral';
import * as Boom from 'boom';
import * as _get from 'lodash.get';

export class PeabodyRoutes extends RoutePlugin {
    @inject('camera')
    private camera: CameraService;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

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
            const result = await this.camera.login();

            return h.response(result).code(201);
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
            const result = await this.camera.logout();

            return h.response(result).code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/peabody/video',
        options: {
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['peabody'],
            description: 'Configure video out settings (resolution, encoder, bitrate, fps)'
        }
    })
    // @ts-ignore (request)
    public async postVideo(request: Request, h: ResponseToolkit) {
        try {
            const payloadSettings = _get(request, 'payload');
            const videoSettings = {
                resolutionSelectVal: this.camera.currentResolutionSelectVal,
                encodeModeSelectVal: this.camera.currentEncodeModeSelectVal,
                bitRateSelectVal: this.camera.currentBitRateSelectVal,
                fpsSelectVal: this.camera.currentFpsSelectVal,
                displayOut: this.camera.currentDisplayOutVal,
                ...payloadSettings
            };

            await this.camera.configureDisplayOut(videoSettings);

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
            description: 'Turn video preview (HDMI out) on/off'
        }
    })
    // @ts-ignore (request)
    public async postPreview(request: Request, h: ResponseToolkit) {
        try {
            const switchStatus = _get(request, 'payload.switchStatus');

            const result = await this.camera.togglePreview(switchStatus || false);

            return h.response(result).code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/peabody/vam',
        options: {
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['peabody'],
            description: 'Turn the inferencing engine (VAM) on/off'
        }
    })
    // @ts-ignore (request)
    public async postVam(request: Request, h: ResponseToolkit) {
        try {
            const switchStatus = _get(request, 'payload.switchStatus');

            await this.camera.toggleVam(switchStatus || false);

            return h.response().code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/peabody/overlay',
        options: {
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['peabody'],
            description: 'Turn inference overlay (ROI boxes) on/off'
        }
    })
    // @ts-ignore (request)
    public async postOverlay(request: Request, h: ResponseToolkit) {
        try {
            const switchStatus = _get(request, 'payload.switchStatus');

            await this.camera.toggleOverlay(switchStatus || false);

            return h.response().code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/peabody/overlayconfig',
        options: {
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['peabody'],
            description: 'Configure inference overlay type and text'
        }
    })
    // @ts-ignore (request)
    public async postOverlayConfig(request: Request, h: ResponseToolkit) {
        try {
            const overlayType = _get(request, 'payload.type') || 'inference';
            const overlayText = _get(request, 'payload.text');

            await this.camera.configureOverlay(overlayType, overlayText);

            return h.response().code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }

    @route({
        method: 'POST',
        path: '/api/v1/peabody/model',
        options: {
            payload: {
                output: 'stream',
                maxBytes: 1024 * 1024 * 100, // BAD! Need a streaming solution for HapiJS
                allow: 'multipart/form-data',
                parse: true
            },
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['peabody'],
            description: 'Upload a new dlc model file and activate it'
        }
    })
    // @ts-ignore (request)
    public async postChangeModel(request: Request, h: ResponseToolkit) {
        try {
            const file = (request.payload as any).model;
            if (!file) {
                throw Boom.badRequest('No file descriptor found in the form data request');
            }

            const result = await this.camera.changeModel(file);

            return h.response(result).code(201);
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


    @route({
        method: 'POST',
        path: '/api/v1/peabody/dps',
        options: {
            auth: {
                strategies: ['peabody-jwt', 'peabody-localnetwork'],
                access: {
                    scope: ['api-client', 'admin']
                }
            },
            tags: ['peabody'],
            description: 'Provision this device with IoT Central'
        }
    })
    // @ts-ignore (request)
    public async postDpsProvision(request: Request, h: ResponseToolkit) {
        try {
            await this.iotCentral.iotCentralDpsProvisionDevice();

            return h.response().code(201);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }
}
