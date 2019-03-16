// tslint:disable:no-console
const childProcess = require('child_process');
const os = require('os');

const processArgs = require('commander')
    .option('-b, --docker-build', 'Docker build the image')
    .option('-p, --docker-push', 'Docker push the image')
    .option('-v, --image-version <version>', 'Docker image version override')
    .parse(process.argv);

const dockerVersion = process.env.npm_package_version || processArgs.imageVersion || 'latest';
const dockerImage = `${process.env.npm_package_config_imageName}:${dockerVersion}`;

async function execDockerBuild() {
    const dockerArgs = [
        'build',
        '-t',
        dockerImage,
        '.'
    ];

    childProcess.execFileSync('docker', dockerArgs, { stdio: [0, 1, 2] });
}

async function execDockerPush() {
    const dockerArgs = [
        'push',
        dockerImage
    ];

    childProcess.execFileSync('docker', dockerArgs, { stdio: [0, 1, 2] });
}

async function start() {
    console.log(`Docker image: ${dockerImage}`);
    console.log(`Platform: ${os.type()}`);

    let buildFailed = false;

    try {
        if (processArgs.dockerBuild) {
            await execDockerBuild();
        }

        if (processArgs.dockerPush) {
            await execDockerPush();
        }
    } catch (e) {
        buildFailed = true;
    } finally {
        if (!buildFailed) {
            console.log(`Operation complete`);
        }
    }

    if (buildFailed) {
        console.log(`Operation failed, see errors above`);
        process.exit(-1);
    }
}

start();
// tslint:enable:no-console
