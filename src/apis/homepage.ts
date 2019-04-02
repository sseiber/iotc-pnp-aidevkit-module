import { RoutePlugin, route } from 'spryly';
import { Request, ResponseToolkit } from 'hapi';
import {
    dirname as pathDirname,
    join as pathJoin,
    resolve as pathResolve
} from 'path';

const rootDirectory = pathJoin(pathDirname(require.main.filename), '..');

export class HomePageRoutes extends RoutePlugin {
    @route({
        method: 'GET',
        path: '/',
        options: {
            tags: ['homepage'],
            description: 'The homepage spa'
        }
    })
    // @ts-ignore (request)
    public async getHomePage(request: Request, h: ResponseToolkit) {
        const homePageView = pathResolve(rootDirectory, 'client_dist', 'index.html');

        return h.file(homePageView);
    }

    @route({
        method: 'GET',
        path: '/peabody/{path*}',
        options: {
            tags: ['homepage'],
            description: 'The homepage spa'
        }
    })
    // @ts-ignore (request)
    public async getHomePage(request: Request, h: ResponseToolkit) {
        const homePageView = pathResolve(rootDirectory, 'client_dist', 'index.html');

        return h.file(homePageView);
    }

    @route({
        method: 'GET',
        path: '/favicon.ico',
        options: {
            tags: ['homepage'],
            description: 'The homepage favicon',
            handler: {
                file: pathJoin(rootDirectory, 'static', 'favicon.ico')
            }
        }
    })
    // @ts-ignore (request, h)
    public async getFavicon(request: Request, h: ResponseToolkit) {
        return;
    }

    @route({
        method: 'GET',
        path: '/static/{path*}',
        options: {
            tags: ['homepage'],
            description: 'The homepage static assets',
            handler: {
                directory: {
                    path: pathJoin(rootDirectory, 'static'),
                    index: false
                }
            }
        }
    })
    // @ts-ignore (request , h)
    public async getStatic(request: Request, h: ResponseToolkit) {
        return;
    }

    @route({
        method: 'GET',
        path: '/dist/{path*}',
        options: {
            tags: ['homepage'],
            description: 'The homepage spa bundles',
            handler: {
                directory: {
                    path: pathJoin(rootDirectory, 'client_dist'),
                    index: false
                }
            }
        }
    })
    // @ts-ignore (request, h)
    public async getDist(request: Request, h: ResponseToolkit) {
        return;
    }

    @route({
        method: 'GET',
        path: '/client_dist/{path*}',
        options: {
            tags: ['homepage'],
            description: 'The homepage spa bundles',
            handler: {
                directory: {
                    path: pathJoin(rootDirectory, 'client_dist'),
                    index: false
                }
            }
        }
    })
    // @ts-ignore (request, h)
    public async getClientDist(request: Request, h: ResponseToolkit) {
        return;
    }
}
