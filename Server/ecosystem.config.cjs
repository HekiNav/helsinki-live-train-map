module.exports = {
  apps : [{
    name   : "hki-ltm-api",
    script : "npm start",
    ignore_watch: ["./src/comp_cache.db"],
    cron_restart: "0 * * * *"
  }]
}
