import * as Boom from '@hapi/boom';
import * as assert from 'assert';
import {
    verify as jwtVerify,
    decode as jwtDecode
} from 'jsonwebtoken';
import * as Cookie from 'cookie';

const internals: any = {};

exports.plugin = {
    name: 'jwtAuth',

    // @ts-ignore (options)
    register: (server, options) => {
        server.auth.scheme('jwt', internals.implementation);
    }
};

internals.checkObjectType = (objectToCheck) => {
    const toString = Object.prototype.toString;

    return toString.call(objectToCheck);
};

internals.isFunction = (functionToCheck) => {
    return (functionToCheck && (internals.checkObjectType(functionToCheck) === '[object Function]' || internals.checkObjectType(functionToCheck) === '[object AsyncFunction]'));
};

internals.getKeys = async (decoded, options) => {
    const { key, ...extraInfo } = internals.isFunction(options.key) ? await options.key(decoded) : { key: options.key };
    const keys = Array.isArray(key) ? key : [key];

    return { keys, extraInfo };
};

internals.verifyJwt = (token, keys, options) => {
    let error;
    for (const k of keys) {
        try {
            return jwtVerify(token, k, options.verifyOptions);
        }
        catch (ex) {
            error = ex;
        }
    }

    throw error;
};

internals.customOrDefaultKey = (options, key, defaultKey) => {
    return options[key] === false || typeof options[key] === 'string' ? options[key] : defaultKey;
};

internals.extract = (request, options) => {
    let auth;
    let token;
    const cookieKey = internals.customOrDefaultKey(options, 'cookieKey', 'token');
    const headerKey = internals.customOrDefaultKey(options, 'headerKey', 'authorization');
    const urlKey = internals.customOrDefaultKey(options, 'urlKey', 'token');
    const pattern = new RegExp(`${options.tokenType}\\s+([^$]+)`, 'i');

    if (urlKey && request.query[urlKey]) {
        auth = request.query[urlKey];
    }
    else if (headerKey && request.headers[headerKey]) {
        if (typeof options.tokenType === 'string') {
            token = request.headers[headerKey].match(pattern);
            auth = token === null ? null : token[1];
        }
        else {
            auth = request.headers[headerKey];
        }
    }
    else if (cookieKey && request.headers.cookie) {
        auth = Cookie.parse(request.headers.cookie)[cookieKey];
    }

    return auth ? auth.replace(/Bearer/gi, '').replace(/ /g, '') : null;
};

internals.isValid = (token) => {
    return token.split('.').length === 3;
};

internals.isHeadless = (token) => {
    return token.split('.').length === 2;
};

// @ts-ignore (server)
internals.implementation = (server, options) => {
    assert(options, 'options are required for jwt auth scheme');
    assert(options.validate || options.verify, 'validate OR verify function is required!');

    function raiseError(errorType, message, scheme?, attributes?) {
        let errorContext = {
            errorType,
            message,
            scheme,
            attributes
        };

        if (internals.isFunction(options.errorFunc)) {
            errorContext = options.errorFunc(errorContext);
        }

        return Boom[errorContext.errorType](
            errorContext.message,
            errorContext.scheme,
            errorContext.attributes
        );
    }

    return {
        authenticate: async (request, h) => {
            let token = internals.extract(request, options);
            const tokenType = options.tokenType || 'Token';
            let decoded;

            if (!token) {
                return h.unauthenticated(raiseError('unauthorized', null, tokenType), { credentials: tokenType });
            }

            if (options.headless && typeof options.headless === 'object' && internals.isHeadless(token)) {
                token = `${Buffer.from(JSON.stringify(options.headless)).toString('base64')}.${token}`;
            }

            if (!internals.isValid(token)) {
                return h.unauthenticated(raiseError('unauthorized', 'Invalid token format', tokenType), { credentials: token });
            }

            request.auth.token = token;

            try {
                decoded = jwtDecode(token, { complete: options.complete || false });
            }
            catch (ex) {
                return h.unauthenticated(raiseError('unauthorized', 'Invalid token format', tokenType), { credentials: token });
            }

            if (typeof options.validate === 'function') {
                const { keys, extraInfo } = await internals.getKeys(decoded, options);

                if (extraInfo) {
                    request.plugins.jwtAuth = { extraInfo };
                }

                let verifyDecoded;
                try {
                    verifyDecoded = internals.verifyJwt(token, keys, options);
                }
                catch (ex) {
                    const errorMessage = ex.message === 'jwt expired' ? 'Expired token' : 'Invalid token';

                    return h.unauthenticated(raiseError('unauthorized', errorMessage, tokenType), { credentials: token });
                }

                try {
                    const { isValid, credentials, response } = await options.validate(verifyDecoded, request, h);

                    if (response !== undefined) {
                        return h.response(response).takeover();
                    }

                    if (!isValid) {
                        return h.unauthenticated(raiseError('unauthorized', 'Invalid credentials', tokenType), { credentials: decoded });
                    }

                    return h.authenticated({
                        credentials:
                            credentials && typeof credentials === 'object'
                                ? credentials
                                : decoded,
                        artifacts: token
                    });
                }
                catch (ex) {
                    return h.unauthenticated(raiseError('boomify', ex), { credentials: decoded });
                }
            }

            try {
                const { isValid, credentials } = await options.verify(decoded, request);

                if (!isValid) {
                    return h.unauthenticated(raiseError('unauthorized', 'Invalid credentials', tokenType), { credentials: decoded });
                }

                return h.authenticated({
                    credentials,
                    artifacts: token
                });
            }
            catch (ex) {
                return h.unauthenticated(raiseError('boomify', ex), { credentials: decoded });
            }
        },

        payload: (request, h) => {
            const payloadFunc = options.payloadFunc;

            if (payloadFunc && typeof payloadFunc === 'function') {
                return payloadFunc(request, h);
            }

            return h.continue;
        },

        response: (request, h) => {
            const responseFunc = options.responseFunc;

            if (responseFunc && typeof responseFunc === 'function') {
                if (internals.checkObjectType(responseFunc) === '[object AsyncFunction]') {
                    return responseFunc(request, h)
                        .then(() => h.continue)
                        .catch(err => raiseError('boomify', err));
                }

                try {
                    responseFunc(request, h);
                }
                catch (ex) {
                    throw raiseError('boomify', ex);
                }
            }

            return h.continue;
        },

        verify: async (auth) => {
            const token = auth.artifacts;
            const decoded = jwtDecode(token, { complete: options.complete || false });

            const { keys } = await internals.getKeys(decoded, options);

            internals.verifyJwt(token, keys, options);
        }
    };
};
