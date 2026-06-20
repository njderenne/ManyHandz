import { useState } from 'react'
import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { MeasurementInput, MeasurementValue } from '@/components/ui/measurement-input'
import { Section, Row } from '@/components/gallery/kit'
import { usePrefs } from '@/lib/prefs'
import { formatMeasurement, type UnitSystem } from '@/lib/config/units'

/**
 * Measurement units gallery — the MeasurementInput stores a canonical SI value (cm/kg/m) while
 * displaying in the active system, and MeasurementValue renders a stored value in either system.
 * The override segmented control here shows the SAME canonical numbers in both systems side by
 * side, proving the value is unit-agnostic.
 */
export default function MeasurementScreen() {
  // Canonical SI state: centimetres, kilograms, metres.
  const [heightCm, setHeightCm] = useState<number | undefined>(182.88) // 6 ft 0 in
  const [weightKg, setWeightKg] = useState<number | undefined>(70) // ~154 lbs
  const [distanceM, setDistanceM] = useState<number | undefined>(5000) // 5 km / ~3.1 mi

  const prefSystem = usePrefs((s) => s.unitSystem)
  const setUnitSystem = usePrefs((s) => s.setUnitSystem)

  return (
    <PageWrapper className="gap-8 pb-24">
      <View className="gap-1">
        <Text variant="h1">Measurement</Text>
        <Text variant="muted">
          Stores a canonical SI value (cm / kg / m); displays in the active unit system. Flip the
          preference and every value re-renders — no data changes.
        </Text>
      </View>

      <Section title="Active unit system" description="Bound to the device preference (Preferences → Units)">
        <SegmentedControl
          value={prefSystem}
          onValueChange={(v) => setUnitSystem(v as UnitSystem)}
          options={[
            { label: 'Imperial', value: 'imperial' },
            { label: 'Metric', value: 'metric' },
          ]}
        />
      </Section>

      <Section title="Inputs" description="Type in the active unit; canonical SI value is stored">
        <MeasurementInput
          kind="length"
          label="Height"
          value={heightCm}
          onValueChange={setHeightCm}
          helper={`Stored: ${heightCm?.toFixed(2) ?? '—'} cm`}
        />
        <MeasurementInput
          kind="weight"
          label="Weight"
          value={weightKg}
          onValueChange={setWeightKg}
          helper={`Stored: ${weightKg?.toFixed(2) ?? '—'} kg`}
        />
        <MeasurementInput
          kind="distance"
          label="Distance"
          value={distanceM}
          onValueChange={setDistanceM}
          helper={`Stored: ${distanceM?.toFixed(2) ?? '—'} m`}
        />
      </Section>

      <Section title="Same data, both systems" description="One canonical value formatted in each system">
        <Card>
          <CardContent className="gap-3">
            <Row label="Height (imperial)">
              <MeasurementValue value={heightCm} kind="length" system="imperial" feetInches />
            </Row>
            <Row label="Height (metric)">
              <MeasurementValue value={heightCm} kind="length" system="metric" />
            </Row>
            <Row label="Weight (imperial)">
              <MeasurementValue value={weightKg} kind="weight" system="imperial" />
            </Row>
            <Row label="Weight (metric)">
              <MeasurementValue value={weightKg} kind="weight" system="metric" />
            </Row>
            <Row label="Distance (imperial)">
              <MeasurementValue value={distanceM} kind="distance" system="imperial" />
            </Row>
            <Row label="Distance (metric)">
              <MeasurementValue value={distanceM} kind="distance" system="metric" />
            </Row>
          </CardContent>
        </Card>
      </Section>

      <Section title="formatMeasurement()" description="The pure formatter behind MeasurementValue">
        <Card>
          <CardContent className="gap-2">
            <Text variant="caption">182.88 cm → {formatMeasurement(182.88, 'length', 'imperial', { feetInches: true })}</Text>
            <Text variant="caption">182.88 cm → {formatMeasurement(182.88, 'length', 'metric')}</Text>
            <Text variant="caption">70 kg → {formatMeasurement(70, 'weight', 'imperial')}</Text>
            <Text variant="caption">5000 m → {formatMeasurement(5000, 'distance', 'metric')}</Text>
            <Text variant="caption">5000 m → {formatMeasurement(5000, 'distance', 'imperial')}</Text>
          </CardContent>
        </Card>
      </Section>
    </PageWrapper>
  )
}
