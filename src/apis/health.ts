import { inject, RoutePlugin, route } from 'spryly';
import { Request, ResponseToolkit } from 'hapi';
import { CameraService } from '../services/camera';
import { SubscriptionService } from '../services/subscription';
import * as Boom from 'boom';

export class HealthRoutes extends RoutePlugin {
    @inject('camera')
    private camera: CameraService;

    @inject('subscription')
    private subscription: SubscriptionService;

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
            this.subscription.publishHealth({ state: 'healthy' });

            const result = await this.camera.checkHealthState();

            return h.response(result).code(200);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }
}
