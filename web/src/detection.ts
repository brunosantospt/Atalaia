// When the fire is detected on the simulation's timeline (public/detection.json): by the drone,
// which starts the clock of the means, and by the satellite, the conventional way, marked on the
// same timeline as the moment the attack would begin without the drone.

export interface Detection {
  notes: string
  droneMin: number // minutes from the ignition to the drone's detection: T0 of the ETAs
  satelliteMin: number // minutes from the ignition to the conventional detection: the T_sat mark
  sources: Record<string, string>
}

export async function loadDetection(): Promise<Detection> {
  const response = await fetch('/detection.json')
  if (!response.ok) throw new Error(`/detection.json: HTTP ${response.status}`)
  return response.json() as Promise<Detection>
}
