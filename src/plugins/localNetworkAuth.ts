import { Server, Plugin } from '@hapi/hapi';
import { Netmask } from 'netmask';
import * as Boom from '@hapi/boom';
import { networkInterfaces } from 'os';

const internals: any = {};

export const LocalNetworkAuthPlugin: Plugin<any> = {
    name: 'localnetwork',

    // @ts-ignore (server, options)
    register: (server: Server, options: any) => {
        server.auth.scheme('localnetwork', internals.implementation);
    }
};

// @ts-ignore (server, options)
internals.implementation = (server, options) => {
    const masks = internals.getNetworkMasks();

    return {
        authenticate: (request, h) => {
            const onLocalNetwork = masks.some(mask => mask.contains(request.info.remoteAddress));

            if (!onLocalNetwork) {
                throw Boom.unauthorized(null, 'localnetwork-auth');
            }

            // TODO: Get this from scheme configuration
            return h.authenticated({ credentials: { scope: ['local', 'admin'] } });
        }
    };
};

internals.getNetworkMasks = () => {
    const interfaces = networkInterfaces();

    const masks = [];

    Object.keys(interfaces).forEach((key) => {
        masks.push(...interfaces[key].filter(i => i.family === 'IPv4')
            .map(i => new Netmask(i.address, i.netmask))
            .filter(Boolean));
    });

    return masks;
};
