import { inject, RoutePlugin, route } from 'spryly';
import { Request, ResponseToolkit } from 'hapi';
import { SubscriptionService } from '../services/subscription';

export class HealthRoutes extends RoutePlugin {
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
    public health(request: Request, h: ResponseToolkit) {
        this.subscription.publishHealth({ state: 'healthy' });

        return h.response('healthy').code(200);
    }
}
