import { inject, RoutePlugin, route } from 'spryly';
import { Request, ResponseToolkit } from '@hapi/hapi';
import { HealthState, HealthService } from '../services/health';
import { SubscriptionService } from '../services/subscription';
import * as Boom from '@hapi/boom';
import * as _get from 'lodash.get';

export class HealthRoutes extends RoutePlugin {
    @inject('health')
    private health: HealthService;

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
    public async getHealth(request: Request, h: ResponseToolkit) {
        try {
            this.subscription.publishHealth({ state: 'healthy' });

            const healthState = _get(process.env, 'FORCE_HEALTHCHECK') === '1'
                ? HealthState.Good
                : await this.health.checkHealthState();

            return h.response(`HealthState: ${healthState}`).code(200);
        }
        catch (ex) {
            throw Boom.badRequest(ex.message);
        }
    }
}
