import { RoutePlugin, route } from '@sseiber/sprightly';
import { Request, ResponseToolkit } from 'hapi';

export class HealthRoutes extends RoutePlugin {
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
        return h.response('healthy').code(200);
    }
}
