import * as Boom from '@hapi/boom';
import {
    assert as hoekAssert,
    clone as hoekClone
} from '@hapi/hoek';
import { jwt as jwtVerify } from 'jsonwebtoken';

const internals: any = {};

exports.plugin = {
    name: 'jwtAuth',

    // @ts-ignore (options)
    register: (server, options) => {
        server.auth.scheme('jwt', internals.implementation);
    }
};

// @ts-ignore (server)
internals.implementation = (server, options) => {
    hoekAssert(options, 'Missing jwt auth strategy options');
    hoekAssert(options.key, 'Missing required private key in configuration');

    const settings = hoekClone(options);
    settings.verifyOptions = settings.verifyOptions || {};

    const scheme = {
        authenticate: (request, h) => {
            const req = request.raw.req;
            const authorization = req.headers.authorization;

            if (!authorization) {
                throw Boom.unauthorized(null, 'Bearer');
            }

            const parts = authorization.split(/\s+/);

            if (parts.length !== 2) {
                throw Boom.badRequest('Bad HTTP authentication header format', 'Bearer');
            }

            if (parts[0].toLowerCase() !== 'bearer') {
                throw Boom.unauthorized(null, 'Bearer');
            }

            if (parts[1].split('.').length !== 3) {
                throw Boom.badRequest('Bad HTTP authentication header format', 'Bearer');
            }

            const token = parts[1];

            jwtVerify(token, settings.key, settings.verifyOptions || {}, (err, decoded) => {
                if (err && err.message === 'jwt expired') {
                    throw Boom.unauthorized('Expired token received for JSON Web Token validation', 'Bearer');
                } else if (err) {
                    throw Boom.unauthorized('Invalid signature received for JSON Web Token validation', 'Bearer');
                }

                if (!settings.validateFunc) {
                    return h.authenticated({ credentials: decoded });
                }

                settings.validateFunc(request, decoded, (validateError, isValid, credentials) => {
                    credentials = credentials || null;

                    if (validateError) {
                        return h.response(validateError, null, { credentials });
                    }

                    if (!isValid) {
                        return h.response(Boom.unauthorized('Invalid token', 'Bearer'), null, { credentials });
                    }

                    if (!credentials || typeof credentials !== 'object') {
                        return h.response(Boom.badImplementation('Bad credentials object received for jwt auth validation'), null, { log: { tags: 'credentials' } });
                    }

                    // Authenticated
                    return h.authenticated({ credentials });
                });
            });
        }
    };

    return scheme;
};
