/** @type {import('next').NextConfig} */
const API = process.env.API_URL || "http://127.0.0.1:8077";
const path = require("path");
module.exports = {
  output: "standalone",
  turbopack: { root: __dirname },
  outputFileTracingRoot: path.join(__dirname),
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
