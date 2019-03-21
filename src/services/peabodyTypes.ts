export class CameraResult {
    public status: boolean;
    public title: string;
    public message: string;

    constructor(status: boolean, title: string, message: string) {
        this.status = status || false;
        this.title = title || '';
        this.message = message || '';
    }
}
