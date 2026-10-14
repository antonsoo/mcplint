/** Bound buffered SSE lines and joined event data in original UTF-8 bytes.
 * Completed comments, retry and header lines do not accumulate as event data.
 * Framing uses LF, CR and split CRLF; payload validation remains the parser's job.
 */
export class SseMessageBounds {
  private lineBytes = 0;
  private prefix: number[] = [];
  private dataBytes = 0;
  private dataLines = 0;
  private afterCr = false;
  private firstLine = true;

  constructor(private readonly limit: number, private readonly fail: () => never) {}

  feed(chunk: Uint8Array): void {
    let start = 0;
    if (this.afterCr) {
      if (chunk[0] === 10) start = 1;
      if (chunk.length) this.afterCr = false;
    }
    while (start < chunk.length) {
      const lf = chunk.indexOf(10, start);
      const cr = chunk.indexOf(13, start);
      const end = lf < 0 ? (cr < 0 ? chunk.length : cr) : (cr < 0 ? lf : Math.min(lf, cr));
      for (let i = start; i < end && this.prefix.length < 9; i++) this.prefix.push(chunk[i]!);
      this.lineBytes += end - start;
      if (this.lineBytes > this.limit) this.fail();
      this.checkData();
      if (end === chunk.length) return;
      this.endLine();
      start = end + 1;
      if (chunk[end] === 13) {
        if (chunk[start] === 10) start++;
        else if (start === chunk.length) this.afterCr = true;
      }
    }
  }

  private field(ended = false): { data: boolean; payload: number } {
    let prefix = String.fromCharCode(...this.prefix);
    const bom = this.firstLine && prefix.startsWith('\u00ef\u00bb\u00bf');
    if (bom) prefix = prefix.slice(3);
    const length = this.lineBytes - (bom ? 3 : 0);
    if (prefix.startsWith('data:')) {
      return { data: true, payload: length - (prefix[5] === ' ' ? 6 : 5) };
    }
    return { data: ended && length === 4 && prefix === 'data', payload: 0 };
  }

  private checkData(): void {
    const field = this.field();
    if (field.data && this.dataBytes + (this.dataLines ? 1 : 0) + field.payload > this.limit) this.fail();
  }

  private endLine(): void {
    if (this.lineBytes === 0 || (this.firstLine && this.lineBytes === 3 && this.prefix.join(',') === '239,187,191')) {
      this.dataBytes = 0;
      this.dataLines = 0;
    } else {
      const field = this.field(true);
      if (field.data) {
        this.dataBytes += (this.dataLines ? 1 : 0) + field.payload;
        this.dataLines++;
        if (this.dataBytes > this.limit) this.fail();
      }
    }
    this.lineBytes = 0;
    this.prefix = [];
    this.firstLine = false;
  }
}
