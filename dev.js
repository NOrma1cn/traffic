const { exec, spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT_DIR = __dirname;
const FRONTEND_DIR = path.join(__dirname, 'frontend');
const PORTS = [8000, 8010];
const BACKEND_PORT = 8010;

function killListeningPort(port) {
  return new Promise((resolve) => {
    exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
      if (!stdout) {
        resolve();
        return;
      }

      const lines = stdout.split('\n');
      const pids = new Set();
      for (const line of lines) {
        if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') pids.add(pid);
      }

      if (!pids.size) {
        resolve();
        return;
      }

      const tasks = Array.from(pids).map(
        (pid) =>
          new Promise((done) => {
            console.log(`[DevRunner] Stopping process on port ${port} (PID ${pid})`);
            exec(`taskkill /PID ${pid} /F`, () => done());
          }),
      );
      Promise.all(tasks).then(() => resolve());
    });
  });
}

async function cleanupPorts() {
  for (const port of PORTS) {
    await killListeningPort(port);
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('[DevRunner] Initializing Caltrans Dashboard Environment');
  console.log('======================================================\n');

  await cleanupPorts();

  console.log('[DevRunner] Launching Caltrans backend on port 8010\n');

  const ckpt =
    process.env.TRAFFIC_BACKEND_CKPT ||
    path.join(ROOT_DIR, 'runs_d03', 'd03_baseline_pure_st', 'best.pt');
  const correctionCkpt =
    process.env.TRAFFIC_BACKEND_CORRECTION_CKPT ||
    path.join(ROOT_DIR, 'runs_d03', 'correction_model', 'correction_model.pt');
  const trafficDir =
    process.env.TRAFFIC_BACKEND_TRAFFIC_DIR ||
    path.join(ROOT_DIR, 'Caltrans_2023_D03', 'processed_d03_2023_ml95_enriched');
  const weatherNpy =
    process.env.TRAFFIC_BACKEND_WEATHER_NPY ||
    path.join(
      ROOT_DIR,
      'Caltrans_2023_D03',
      'weather_d03_2023_rich',
      'd03_weather_aligned_to_processed_d03_2023_ml95_2023.npy',
    );
  const weatherCsv =
    process.env.TRAFFIC_BACKEND_WEATHER_CSV ||
    path.join(
      ROOT_DIR,
      'Caltrans_2023_D03',
      'weather_d03_2023_rich',
      'd03_weather_hourly_mean_2023.csv',
    );
  const tickSeconds = String(process.env.TRAFFIC_BACKEND_TICK_SECONDS || '10');

  console.log(`[DevRunner] Checkpoint: ${ckpt}`);
  console.log(`[DevRunner] Traffic dir: ${trafficDir}`);
  console.log(`[DevRunner] Weather npy: ${weatherNpy}`);
  console.log(`[DevRunner] Weather csv: ${weatherCsv}`);
  console.log(`[DevRunner] Tick seconds: ${tickSeconds}\n`);

  const backend = spawn(
    'python',
    [
      '-m',
      'backend.server_d03_pipeline',
      '--host',
      '127.0.0.1',
      '--port',
      String(BACKEND_PORT),
      '--ckpt',
      ckpt,
      '--correction-ckpt',
      correctionCkpt,
      '--traffic-dir',
      trafficDir,
      '--weather-npy',
      weatherNpy,
      '--weather-csv',
      weatherCsv,
      '--tick-seconds',
      tickSeconds,
    ],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    },
  );

  await new Promise((resolve) => {
    const check = () => {
      http
        .get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            try {
              const j = JSON.parse(raw);
              if (res.statusCode === 200 && j?.ok === true) {
                console.log(`[DevRunner] Backend is healthy at http://127.0.0.1:${BACKEND_PORT}`);
                resolve();
                return;
              }
            } catch {}
            setTimeout(check, 1000);
          });
        })
        .on('error', () => {
          setTimeout(check, 1000);
        });
    };
    check();
  });

  console.log('\n[DevRunner] Launching React Frontend (Vite)\n');

  const frontend = spawn('npm', ['run', 'dev:vite'], {
    cwd: FRONTEND_DIR,
    shell: true,
    stdio: 'inherit',
  });

  const cleanup = async () => {
    console.log('\n[DevRunner] Received shutdown signal. Terminating services...');
    try {
      frontend.kill();
    } catch {}
    try {
      backend.kill();
    } catch {}
    await cleanupPorts();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  frontend.on('exit', cleanup);
}

main();
