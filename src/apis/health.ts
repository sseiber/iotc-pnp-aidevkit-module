import { inject, RoutePlugin, route } from 'spryly';
import { Server, Request, ResponseToolkit } from '@hapi/hapi';
import { CameraService } from '../services/camera';
import { Subscription } from '../services/socket';
import * as Boom from '@hapi/boom';

export class HealthRoutes extends RoutePlugin {
    @inject('$server')
    private server: Server;

    @inject('camera')
    private camera: CameraService;

    @route({
        method: 'GET',
        path: '/health',
        options: {
            tags: ['health'],
            description: 'Health status',
            auth: false
        }
    })
    // @ts-ignore (request)
    public async health(request: Request, h: ResponseToolkit) {
        try {
            const healthState = await this.camera.checkHealthState() || 0;

            await this.server.publish(Subscription.Health, { state: healthState });

            return h.response(`HealthState: ${healthState}`).code(200);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }
}
