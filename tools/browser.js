/**
 * A minimal Chrome driver, for the tests that a DOM stub cannot answer.
 *
 * ## Why this exists
 *
 * The suite drives the renderer through `testdom.js`, which is fast, needs no
 * browser and is exactly right for the things it can see: what elements were
 * created, what attributes were written, what the model did. It cannot see the
 * two things that have caused every visual defect in this project — **the
 * cascade** and **layout**.
 *
 * Three real bugs shipped behind green tests for that reason:
 *
 * - the header's affordances overlapped, because the arithmetic that stacks
 *   them stepped past the wrong width, and nothing computed a box;
 * - the sort arrow jumped to the far end of the heading when a column was
 *   sorted, because `position` was scoped to a state selector;
 * - a chart's y axis had no labels at all, because a pooled group deleted them,
 *   and later the caller's font size never reached the screen because a
 *   presentation attribute loses to a class rule.
 *
 * Every one of those is a question of the form "what did the browser actually
 * compute", and this file exists to ask it.
 *
 * ## Why it is written rather than installed
 *
 * §20: no dependencies, and the test suite has none either. Chrome speaks the
 * DevTools Protocol over a WebSocket, Node 22 has a WebSocket, and the subset
 * needed here — navigate, evaluate, read back JSON — is about a hundred lines.
 * A driver library would be several megabytes to avoid writing them.
 *
 * ## Skipping rather than failing
 *
 * A contributor without Chrome installed must still be able to run the suite.
 * {@link available} answers whether there is a browser to drive, and the tests
 * that need one skip when there is not — the same bargain `check.js` makes with
 * the signing key.
 *
 * ## Surviving a crash (F-1289-A)
 *
 * Chrome is started `detached` (see {@link Browser#start}), which is what
 * lets `close()` reap its whole process tree with one signal instead of
 * leaving zygotes and renderers behind — but it also means nothing kills
 * that tree if the calling script never reaches `close()` at all. Every
 * `Browser` arms an exit safety net at construction (`process.once` on
 * `exit`, `uncaughtException`, `unhandledRejection`, `SIGINT` and
 * `SIGTERM`) that kills its recorded process group, so a thrown error, a
 * `process.exit()`, or an external SIGTERM still leaves no Chrome behind —
 * without changing how the calling script itself crashes or exits.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where Chrome might be, in the order worth trying. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/**
 * The browser binary to drive, if there is one.
 *
 * @returns {string|null} the path, or null when none is installed
 */
export function chromePath() {
  for (const candidate of CANDIDATES) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ['--version'], { timeout: 10000 });
    if (probe.status === 0) return candidate;
  }
  return null;
}

/**
 * Can these tests run here?
 *
 * @returns {boolean} true when a browser is available
 */
export function available() {
  return chromePath() !== null;
}

/**
 * A page in a headless browser, driven over the DevTools Protocol.
 */
export class Browser {
  /** @type {import('node:child_process').ChildProcess|null} */ #process = null;

  /** @type {WebSocket|null} */ #socket = null;

  /** @type {number} the next message id */ #id = 1;

  /** @type {Map<number, {resolve: Function, reject: Function}>} */ #pending = new Map();

  /** @type {string} the profile directory, removed on close */ #profile = '';

  /** @type {string} the page session every command is sent to */ #session = '';

  /** @type {number} pid of the browser's process group leader, 0 when none is running */
  #pid = 0;

  /** @type {boolean} whether the exit-safety-net handlers are currently attached */
  #armed = false;

  /** @type {() => void} bound handler for the process `exit` event */
  #onProcessExit;

  /** @type {(err: unknown) => void} bound handler for `uncaughtException` */
  #onUncaughtException;

  /** @type {(reason: unknown) => void} bound handler for `unhandledRejection` */
  #onUnhandledRejection;

  /** @type {() => void} bound handler for `SIGINT` */
  #onSigint;

  /** @type {() => void} bound handler for `SIGTERM` */
  #onSigterm;

  /**
   * Arm the exit safety net (F-1289-A).
   *
   * `close()` is the only thing that ever reaped Chrome's process tree, and
   * Chrome is started `detached` so that tree survives its parent — so a
   * script that throws, is killed, or exits before it reaches `close()` left
   * the whole tree parented to pid 1, still burning CPU and degrading every
   * later perf line. These handlers exist from the moment the instance does,
   * not from {@link start}, because {@link #killGroup} is already a no-op
   * with no pid recorded (`#pid` starts at 0) — arming early costs nothing
   * and there is no window between construction and `start()` in which a
   * crash would go unguarded once the pid is known.
   *
   * Set `LATTICE_BROWSER_NO_SAFETY_NET` to skip arming, which exists only so
   * a test can prove the net does something by running the same script
   * without it.
   *
   * `close()` removes every one of these (see {@link #disarm}) so a script
   * that opens many browsers, one after another, does not accumulate
   * listeners on the shared `process` object and eventually print
   * `MaxListenersExceededWarning`.
   */
  constructor() {
    if (process.env.LATTICE_BROWSER_NO_SAFETY_NET) return;
    this.#onProcessExit = () => this.#killGroup(this.#pid, 'SIGKILL');
    this.#onUncaughtException = (err) => this.#handleFatal(err);
    this.#onUnhandledRejection = (reason) => this.#handleFatal(reason);
    this.#onSigint = () => this.#handleSignal('SIGINT');
    this.#onSigterm = () => this.#handleSignal('SIGTERM');
    process.once('exit', this.#onProcessExit);
    process.once('uncaughtException', this.#onUncaughtException);
    process.once('unhandledRejection', this.#onUnhandledRejection);
    process.once('SIGINT', this.#onSigint);
    process.once('SIGTERM', this.#onSigterm);
    this.#armed = true;
  }

  /**
   * React to an uncaught exception or unhandled rejection in the calling
   * script.
   *
   * Kills this instance's Chrome tree first — the entire point of the
   * safety net — then reproduces Node's own default reaction to either
   * event (print, exit with code 1). Attaching a listener to `exit`-causing
   * events is what silently cancels Node's default handling of them, so
   * this driver must put it back rather than let a caller's crash behave
   * differently for having opened a browser.
   *
   * @param {unknown} payload the error, or the rejection reason
   * @returns {void}
   */
  #handleFatal(payload) {
    this.#killGroup(this.#pid, 'SIGKILL');
    this.#disarm();
    if (payload instanceof Error) console.error(payload.stack || String(payload));
    else console.error(payload);
    process.exitCode = 1;
    process.exit(1);
  }

  /**
   * React to `SIGINT`/`SIGTERM` delivered to the calling script.
   *
   * Kills this instance's Chrome tree, then removes the very listener that
   * is suppressing Node's default disposition for the signal and
   * re-delivers it to this process, so that default disposition — or any
   * other listener still registered for it, including another `Browser`
   * instance's own copy of this handler — runs exactly as it would without
   * this safety net.
   *
   * @param {NodeJS.Signals} signal the signal received
   * @returns {void}
   */
  #handleSignal(signal) {
    this.#killGroup(this.#pid, 'SIGKILL');
    this.#disarm();
    process.kill(process.pid, signal);
  }

  /**
   * Detach the exit safety net.
   *
   * Idempotent: a second `close()` call, or a fatal/signal handler firing
   * after the browser is already gone, costs nothing.
   *
   * @returns {void}
   */
  #disarm() {
    if (!this.#armed) return;
    process.removeListener('exit', this.#onProcessExit);
    process.removeListener('uncaughtException', this.#onUncaughtException);
    process.removeListener('unhandledRejection', this.#onUnhandledRejection);
    process.removeListener('SIGINT', this.#onSigint);
    process.removeListener('SIGTERM', this.#onSigterm);
    this.#armed = false;
  }

  /**
   * Start a browser and connect to it.
   *
   * A fresh profile directory each time, so one run cannot inherit another's
   * state — and `--headless=new`, because the old headless mode is a different
   * renderer and would defeat the purpose of testing the real one.
   *
   * @returns {Promise<void>} resolves once the connection is open
   */
  async start() {
    const binary = chromePath();
    if (!binary) throw new Error('no browser found');
    this.#profile = mkdtempSync(join(tmpdir(), 'lattice-browser-'));

    this.#process = spawn(binary, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      // Deterministic geometry: a test asserting on pixels must not depend on
      // the machine's own display scaling.
      '--force-device-scale-factor=1',
      '--window-size=1280,900',
      `--user-data-dir=${this.#profile}`,
      '--remote-debugging-port=0',
      'about:blank',
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      // `detached` makes Chrome the leader of a new process group whose id is
      // the child's pid. Chrome forks a tree — zygotes, a gpu process,
      // renderers, network and storage utilities, `chrome_crashpad_handler` —
      // and killing only the top process leaves that tree alive, holding the
      // event loop open until the test file times out. Signalling the whole
      // group in `close()` reaps all of them at once.
      detached: true,
    });
    // Recorded the moment it exists, so the exit-safety-net handlers armed in
    // the constructor (which fire on *any* exit path, not just a graceful
    // `close()`) have a group to kill from here on.
    this.#pid = this.#process.pid;

    const endpoint = await this.#endpoint();
    await this.#connect(endpoint);
    // The endpoint Chrome prints is the *browser*, which has no `Page` or
    // `Runtime` domain — those belong to a page. Attaching gives a session id
    // that every subsequent command is addressed to.
    await this.attachInternal();
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }

  /**
   * Read the debugging endpoint Chrome prints on standard error.
   *
   * The port is asked for as zero so the operating system picks a free one:
   * a fixed port is a test that fails when somebody happens to be using it.
   *
   * @returns {Promise<string>} the WebSocket URL
   */
  #endpoint() {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('browser did not start')), 30000);
      this.#process.stderr.on('data', (chunk) => {
        buffer += String(chunk);
        const match = /ws:\/\/[^\s]+/.exec(buffer);
        if (!match) return;
        clearTimeout(timer);
        resolve(match[0]);
      });
      this.#process.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`browser exited with ${code}`));
      });
    });
  }

  /**
   * Open the WebSocket and route replies back to their callers.
   *
   * @param {string} url the endpoint
   * @returns {Promise<void>} resolves when the socket is open
   */
  #connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.#socket = socket;
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('could not connect to the browser')));
      socket.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const waiting = this.#pending.get(message.id);
        if (!waiting) return;
        this.#pending.delete(message.id);
        if (message.error) waiting.reject(new Error(message.error.message));
        else waiting.resolve(message.result);
      });
    });
  }

  /**
   * Attach to a page, creating one if the browser opened with none.
   *
   * @returns {Promise<void>} resolves once there is a session
   */
  async attachInternal() {
    const { targetInfos } = await this.send('Target.getTargets');
    const page = (targetInfos || []).find((t) => t.type === 'page');
    const targetId = page
      ? page.targetId
      : (await this.send('Target.createTarget', { url: 'about:blank' })).targetId;
    // `flatten` puts the session on the same socket rather than a second one,
    // which is the only mode current Chrome supports.
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.#session = sessionId;
  }

  /**
   * Send one protocol command.
   *
   * @param {string} method the command
   * @param {object} [params] its parameters
   * @returns {Promise<object>} the result
   */
  send(method, params) {
    const id = this.#id++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const frame = { id, method, params: params || {} };
      // Browser-level commands carry no session; everything else is addressed
      // to the page this driver attached to.
      if (this.#session && !method.startsWith('Target.')) frame.sessionId = this.#session;
      this.#socket.send(JSON.stringify(frame));
      setTimeout(() => {
        if (!this.#pending.has(id)) return;
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30000);
    });
  }

  /**
   * Load a page and wait for it to finish.
   *
   * Waits for the document to be complete *and* for two animation frames, so
   * anything the grid or a chart draws on its first frame has been drawn before
   * a test measures it.
   *
   * @param {string} url the address
   * @returns {Promise<void>} resolves once the page is ready
   */
  async open(url) {
    await this.send('Page.navigate', { url });
    await this.evaluate(`new Promise((done) => {
      const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
      if (document.readyState === 'complete') ready();
      else window.addEventListener('load', ready, { once: true });
    })`);
  }

  /**
   * Evaluate an expression in the page and bring the value back.
   *
   * The value is returned by value rather than as a handle, so a caller gets
   * plain JSON to assert on and there is nothing to release.
   *
   * @param {string} expression the JavaScript to run
   * @returns {Promise<unknown>} what it evaluated to
   */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      const message = (detail.exception && detail.exception.description) || detail.text;
      throw new Error(String(message).split('\n')[0]);
    }
    return result.result.value;
  }

  /**
   * Close the browser and clean up after it.
   *
   * @returns {Promise<void>} resolves once it has gone
   */
  async close() {
    try {
      if (this.#socket) this.#socket.close();
    } catch {
      // Already gone; nothing to do.
    }
    this.#socket = null;
    if (this.#process) {
      const child = this.#process;
      const pid = child.pid;
      const ended = new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(resolve, 5000);
      });
      // Chrome spawns a whole tree of processes; because it was started
      // `detached`, that tree shares one process group whose id is `pid`.
      // Ask the group to exit first, then wait for the profile to be released.
      this.#killGroup(pid, 'SIGTERM');
      // Waited for, because Chrome is still writing its profile as it goes and
      // removing the directory under it fails with ENOTEMPTY — which would turn
      // a passing test run into a failing one at the very last step.
      await ended;
      // Whatever survived the graceful signal — a stuck renderer, a crashpad
      // handler — is killed outright so the event loop can drain and the file
      // exits instead of hanging to the timeout.
      this.#killGroup(pid, 'SIGKILL');
      this.#process = null;
    }
    this.#pid = 0;
    this.#disarm();
    if (this.#profile) {
      try {
        rmSync(this.#profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // A temporary directory left behind is untidy, not a failure.
      }
      this.#profile = '';
    }
  }

  /**
   * Signal a process group, tolerating members that have already gone.
   *
   * A negative pid targets the whole group (see `kill(2)`), which is why Chrome
   * is started `detached`: one signal reaps the entire browser tree rather than
   * just the process this driver spawned.
   *
   * @param {number} pid the group leader's pid
   * @param {NodeJS.Signals} signal the signal to send
   * @returns {void}
   */
  #killGroup(pid, signal) {
    if (!pid) return;
    try {
      process.kill(-pid, signal);
    } catch {
      // ESRCH: the group is already gone. Nothing left to signal.
    }
  }

}
