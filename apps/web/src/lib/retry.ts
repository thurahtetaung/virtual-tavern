/**
 * Runs `task` again once if it fails and `retry(err)` agrees (by default, any failure). For the
 * steps of opening a room, where a phone on a flaky network often succeeds at the second try.
 */
export async function retryOnce<T>(
  task: () => Promise<T>,
  retry: (err: unknown) => boolean = () => true,
): Promise<T> {
  try {
    return await task();
  } catch (err) {
    if (!retry(err)) throw err;
    return task();
  }
}

/**
 * Watches one room join over a live socket: the server must answer the join within `ackMs` and
 * send the room within `stateMs` of a good answer, else the join is sent again. Nothing else on
 * the socket would ever retry it, so a lost packet left phones on "Opening the door…" for good.
 */
export class JoinWatch {
  static readonly ACK_MS = 8_000;
  static readonly STATE_MS = 10_000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly rejoin: () => void;

  constructor(rejoin: () => void) {
    this.rejoin = rejoin;
  }

  private arm(ms: number) {
    this.stop();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.rejoin();
    }, ms);
  }

  /** The join was sent. */
  sent() {
    this.arm(JoinWatch.ACK_MS);
  }

  /** The server accepted the join; the room itself should follow. */
  accepted() {
    this.arm(JoinWatch.STATE_MS);
  }

  /** The room arrived (or the join was refused): nothing more to wait for. */
  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
