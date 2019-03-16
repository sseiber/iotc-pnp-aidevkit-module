import { ComposeManifest } from '@sseiber/sprightly';
import { resolve as pathResolve } from 'path';

const DefaultPort = 9010;
const PORT = process.env.PORT || process.env.port || process.env.PORT0 || process.env.port0 || DefaultPort;

export function manifest(config?: any): ComposeManifest {
    return {
        server: {
            port: PORT,
            app: {
                usePortal: config.usePortal,
                rootDirectory: pathResolve(__dirname, '..'),
                peabodyDirectory: process.env.PEABODY_STORAGE || '/data/misc',
                slogan: 'Peabody local service'
            }
        },
        services: [
            './services'
        ],
        plugins: [
            ...[
                {
                    plugin: 'inert'
                },
                {
                    plugin: 'good',
                    options: generateLoggingOptions(config)
                }
            ],
            ...[
                {
                    plugin: './plugins'
                }
            ],
            ...[
                {
                    plugin: './apis'
                }
            ]
        ]
    };
}

// @ts-ignore (config)
function generateLoggingOptions(config: any) {
    return {
        ops: {
            interval: 1000
        },
        reporters: {
            console: [
                {
                    module: 'good-squeeze',
                    name: 'Squeeze',
                    args: [
                        {
                            log: '*',
                            response: '*',
                            request: '*',
                            error: '*'
                        }
                    ]
                },
                {
                    module: 'good-console',
                    args: [
                        {
                            format: '[[]hh:mm:ss [GMT]ZZ[]]',
                            utc: false
                        }
                    ]
                },
                'stdout'
            ]
        }
    };
}
