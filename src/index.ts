import { manifest } from './manifest';
import { compose, ComposeOptions } from 'spryly';
import {
    platform as osPlatform,
    cpus as osCpus,
    freemem as osFreeMem,
    totalmem as osTotalMem
} from 'os';
import { forget } from './utils';

const composeOptions: ComposeOptions = {
    relativeTo: __dirname,
    logger: (t, m) => {
        const tags = ((t && Array.isArray(t)) ? `[opt,${t.join(',')}]` : '[opt]');

        // tslint:disable-next-line:no-console
        console.log(`[${new Date().toTimeString()}] ${tags} ${m}`);
    }
};

// process.on('unhandledRejection', (e) => {
//     // tslint:disable:no-console
//     console.log(['startup', 'error'], `Excepction on startup... ${e.message}`);
//     console.log(['startup', 'error'], e.stack);
//     // tslint:enable:no-console
// });

async function start() {
    const config = {
        usePortal: false
    };

    try {
        const server = await compose(manifest(config), composeOptions);

        server.log(['startup', 'info'], `🚀 Starting HAPI server instance...`);

        await server.start();

        server.log(['startup', 'info'], `✅ Core server started`);
        server.log(['startup', 'info'], `🌎 ${server.info.uri}`);
        server.log(['startup', 'info'], ` > Hapi version: ${server.version}`);
        server.log(['startup', 'info'], ` > Plugins: [${Object.keys(server.registrations).join(', ')}]`);
        server.log(['startup', 'info'], ` > Machine: ${osPlatform()}, ${osCpus().length} core, ` +
            `freemem=${(osFreeMem() / 1024 / 1024).toFixed(0)}mb, totalmem=${(osTotalMem() / 1024 / 1024).toFixed(0)}mb`);

        server.log(['startup', 'info'], `👨‍💻 Starting IoT Central provisioning`);
        await (server.methods.iotCentral as any).connectToIoTCentral();
        server.log(['startup', 'info'], `👩‍💻 Finished IoT Central provisioning`);

        server.log(['startup', 'info'], `📁 Starting Docker image provisioning`);
        await (server.methods.device as any).provisionDockerImage();
        server.log(['startup', 'info'], `📁 Finished Docker image provisioning`);

        server.log(['startup', 'info'], `📷 Starting camera initialzation`);
        await (server.methods.camera as any).startCamera();
        server.log(['startup', 'info'], `📸 Finished camera initialization`);
    }
    catch (error) {
        // tslint:disable-next-line:no-console
        console.log(`['startup', 'error'], 👹 Error starting server: ${error.message}`);
    }
}

forget(start);
