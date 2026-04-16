import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import http from 'http'
import { spawn, type ChildProcess } from 'child_process'

const backendPort = Number(process.env.TRAFFIC_BACKEND_PORT ?? 8010)
const desiredMode = 'multitask_occ_primary_weather_attn'

const fetchHealth = (port: number) =>
  new Promise<{ ok: boolean; tickSeconds: number | null; mode: string | null }>((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
        timeout: 800,
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            const j = JSON.parse(raw)
            const tickSeconds =
              typeof j?.status?.tick_seconds === 'number' ? Number(j.status.tick_seconds) : null
            const mode = typeof j?.status?.mode === 'string' ? String(j.status.mode) : null
            resolve({
              ok: res.statusCode === 200 && j?.ok === true && mode === desiredMode,
              tickSeconds,
              mode,
            })
          } catch {
            resolve({ ok: false, tickSeconds: null, mode: null })
          }
        })
      },
    )
    req.on('error', () => resolve({ ok: false, tickSeconds: null, mode: null }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, tickSeconds: null, mode: null })
    })
    req.end()
  })

const autoStartBackend = () => {
  let child: ChildProcess | null = null
  let hookedSignals = false

  const hookSignalHandlers = () => {
    if (hookedSignals) return
    hookedSignals = true

    const killChild = () => {
      if (!child) return
      try {
        child.kill()
      } catch {
        // ignore
      }
      child = null
    }

    process.on('exit', killChild)
    process.on('SIGINT', () => {
      killChild()
      process.exit(130)
    })
    process.on('SIGTERM', () => {
      killChild()
      process.exit(143)
    })
  }

  return {
    name: 'auto-start-backend',
    async configureServer(server: any) {
      const logger = server?.config?.logger ?? console
      const repoRoot = path.resolve(__dirname, '..')
      const tickSeconds = String(process.env.TRAFFIC_BACKEND_TICK_SECONDS ?? '10')

      const health = await fetchHealth(backendPort)
      if (health.ok) {
        logger.info(`[backend] already running at http://127.0.0.1:${backendPort}`)
        if (health.tickSeconds !== null && String(health.tickSeconds) !== tickSeconds) {
          logger.warn(
            `[backend] tick_seconds=${String(
              health.tickSeconds,
            )} (desired ${tickSeconds}). Stop the old backend and restart Vite dev server if you want 10s demo.`,
          )
        }
        return
      }
      if (health.mode && health.mode !== desiredMode) {
        logger.warn(
          `[backend] incompatible backend mode=${health.mode} already occupies port ${backendPort}; stop it and restart dev server.`,
        )
      }

      const python = String(process.env.TRAFFIC_PYTHON ?? 'python')
      const ckpt =
        String(process.env.TRAFFIC_BACKEND_CKPT ?? '') ||
        path.join(repoRoot, 'runs_d03', 'd03_baseline_pure_st', 'best.pt')
      const correctionCkpt =
        String(process.env.TRAFFIC_BACKEND_CORRECTION_CKPT ?? '') ||
        path.join(repoRoot, 'runs_d03', 'correction_model', 'correction_model.pt')
      const trafficDir =
        String(process.env.TRAFFIC_BACKEND_TRAFFIC_DIR ?? '') ||
        path.join(repoRoot, 'Caltrans_2023_D03', 'processed_d03_2023_ml95_enriched')
      const weatherNpy =
        String(process.env.TRAFFIC_BACKEND_WEATHER_NPY ?? '') ||
        path.join(
          repoRoot,
          'Caltrans_2023_D03',
          'weather_d03_2023_rich',
          'd03_weather_aligned_to_processed_d03_2023_ml95_2023.npy',
        )
      const weatherCsv =
        String(process.env.TRAFFIC_BACKEND_WEATHER_CSV ?? '') ||
        path.join(
          repoRoot,
          'Caltrans_2023_D03',
          'weather_d03_2023_rich',
          'd03_weather_hourly_mean_2023.csv',
        )

      const args = [
        '-m',
        'backend.server_d03_pipeline',
        '--host',
        '127.0.0.1',
        '--port',
        String(backendPort),
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
      ]

      logger.info(`[backend] starting: ${python} ${args.join(' ')}`)
      hookSignalHandlers()

      child = spawn(python, args, { cwd: repoRoot, stdio: 'inherit', windowsHide: true })
      child.on('error', (err) => {
        logger.error(`[backend] failed to start: ${String(err)}`)
      })
      child.on('exit', (code) => {
        logger.warn(`[backend] exited with code ${String(code)}`)
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), autoStartBackend()],
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${backendPort}`,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
