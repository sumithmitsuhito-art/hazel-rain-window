export class ResourceStore {
  constructor(records) { this.records = records; this.urls = new Map(); }
  bytes(file) {
    const record = this.records[file];
    if (!record) throw Error(`Resource missing: ${file}`);
    const binary = atob(record.base64), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  url(file) {
    if (!this.urls.has(file)) {
      const record = this.records[file];
      this.urls.set(file, URL.createObjectURL(new Blob([this.bytes(file)], { type: record.mime })));
    }
    return this.urls.get(file);
  }
  async image(file) {
    const image = new Image(); image.src = this.url(file); await image.decode(); return image;
  }
  dispose() { for (const url of this.urls.values()) URL.revokeObjectURL(url); this.urls.clear(); }
}
