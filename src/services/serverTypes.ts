export interface ICameraResult {
    status: boolean;
    title: string;
    message: string;
    body?: any;
}

export interface IFileUploadDetails {
    formFieldName: string;
    sourceFileName: string;
    destFileName: string;
    mimetype: string;
    destFileDirectory: string;
    destFilePath: string;
    size: number;
}

export const HealthStates = {
    Good: 3,
    Warning: 2,
    Critical: 1
};
