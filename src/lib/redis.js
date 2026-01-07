// file: src/lib/redis.js
// minimal stub so health summary can import and ping() without crashing.
const client = {
  async ping() {
    return "PONG";
  },
};
export { client };
export default client;
