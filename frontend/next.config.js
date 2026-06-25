/** @type {import('next').NextConfig} */
const API = process.env.API_URL || "http://127.0.0.1:8077";
module.exports = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
