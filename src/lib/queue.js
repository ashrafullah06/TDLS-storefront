// file: src/lib/queue.js
// minimal stub; expose info() used by health summary
export async function info() {
  return {
    ready: true,
    workers: 0,
    queued: 0,
  };
}
export default { info };
