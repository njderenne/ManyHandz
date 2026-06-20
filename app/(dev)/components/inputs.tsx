import { useState } from 'react'
import { View } from 'react-native'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SearchBar } from '@/components/ui/search-bar'
import { Select } from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Slider } from '@/components/ui/slider'
import { Stepper } from '@/components/ui/stepper'
import { Rating } from '@/components/ui/rating'
import { OTPInput } from '@/components/ui/otp-input'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { Section, Row } from '@/components/gallery/kit'

/** Inputs tab — buttons + every form control, plus a working validated form. */

const signInSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
})
type SignInValues = z.infer<typeof signInSchema>

export default function InputsScreen() {
  const { toast } = useToast()
  const [checked, setChecked] = useState(true)
  const [agree, setAgree] = useState(false)
  const [radio, setRadio] = useState('weekly')
  const [pushOn, setPushOn] = useState(true)
  const [segment, setSegment] = useState('all')
  const [search, setSearch] = useState('')
  const [plan, setPlan] = useState('')
  const [country, setCountry] = useState('')
  const [toppings, setToppings] = useState<string[]>([])
  const [when, setWhen] = useState<Date | undefined>()
  const [at, setAt] = useState<Date | undefined>()
  const [exactly, setExactly] = useState<Date | undefined>()
  const [slider, setSlider] = useState(40)
  const [qty, setQty] = useState(1)
  const [rating, setRating] = useState(4)
  const [otp, setOtp] = useState('')

  const { control, handleSubmit, formState } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Inputs</Text>

      <Section title="Button — variants">
        <Button variant="default" label="Default" />
        <Button variant="secondary" label="Secondary" />
        <Button variant="destructive" label="Destructive" />
        <Button variant="outline" label="Outline" />
        <Button variant="ghost" label="Ghost" />
      </Section>

      <Section title="Button — sizes & states" description="Loading and disabled buttons telegraph their state">
        <View className="items-start gap-3">
          <Button size="sm" label="Small" />
          <Button size="lg" label="Large" />
          <Button label="Loading" loading />
          <Button label="Disabled" disabled />
        </View>
      </Section>

      <Section title="Text fields">
        <Input label="Email" placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
        <Input label="With helper" placeholder="Username" helper="This is how others see you." />
        <Input label="With error" placeholder="Required" error="This field is required." />
        <Textarea label="Bio" placeholder="Tell us about yourself…" />
      </Section>

      <Section title="Selection controls">
        <Row label="Checkbox">
          <Checkbox checked={checked} onCheckedChange={setChecked} />
        </Row>
        <Row label="Switch (push notifications)">
          <Switch value={pushOn} onValueChange={setPushOn} />
        </Row>
        <View className="gap-1">
          <Text variant="muted">Radio group</Text>
          <RadioGroup
            value={radio}
            onValueChange={setRadio}
            options={[
              { label: 'Daily', value: 'daily' },
              { label: 'Weekly', value: 'weekly' },
              { label: 'Never', value: 'never' },
            ]}
          />
        </View>
      </Section>

      <Section title="Segmented control">
        <SegmentedControl
          value={segment}
          onValueChange={setSegment}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Active', value: 'active' },
            { label: 'Archived', value: 'archived' },
          ]}
        />
      </Section>

      <Section title="Search">
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search anything…" />
      </Section>

      <Section title="Select">
        <Select
          label="Plan"
          value={plan}
          onValueChange={setPlan}
          placeholder="Choose a plan"
          options={[
            { label: 'Free', value: 'free' },
            { label: 'Pro — $19/mo', value: 'pro' },
            { label: 'Team — $49/mo', value: 'team' },
            { label: 'Enterprise', value: 'enterprise' },
          ]}
        />
        <Select
          label="Country (searchable)"
          searchable
          value={country}
          onValueChange={setCountry}
          placeholder="Search countries"
          options={[
            { label: 'Australia', value: 'au' },
            { label: 'Brazil', value: 'br' },
            { label: 'Canada', value: 'ca' },
            { label: 'France', value: 'fr' },
            { label: 'Germany', value: 'de' },
            { label: 'India', value: 'in' },
            { label: 'Japan', value: 'jp' },
            { label: 'Mexico', value: 'mx' },
            { label: 'Spain', value: 'es' },
            { label: 'United Kingdom', value: 'uk' },
            { label: 'United States', value: 'us' },
          ]}
        />
        <Select
          label="Toppings (multiple)"
          multiple
          values={toppings}
          onValuesChange={setToppings}
          placeholder="Pick toppings"
          options={[
            { label: 'Pepperoni', value: 'pepperoni' },
            { label: 'Mushrooms', value: 'mushrooms' },
            { label: 'Onions', value: 'onions' },
            { label: 'Olives', value: 'olives' },
            { label: 'Basil', value: 'basil' },
          ]}
        />
      </Section>

      <Section title="Date & time" description="iOS spinner sheet · Android dialogs · web inputs">
        <DateTimePicker label="Date" mode="date" value={when} onValueChange={setWhen} />
        <DateTimePicker label="Time" mode="time" value={at} onValueChange={setAt} />
        <DateTimePicker label="Date & time" mode="datetime" value={exactly} onValueChange={setExactly} />
      </Section>

      <Section title="Slider">
        <Slider value={slider} onValueChange={setSlider} />
        <Text variant="muted">Value: {slider}</Text>
      </Section>

      <Section title="Stepper & rating">
        <Row label="Quantity">
          <Stepper value={qty} onValueChange={setQty} />
        </Row>
        <Row label="Rating">
          <Rating value={rating} onValueChange={setRating} />
        </Row>
      </Section>

      <Section title="Verification code (OTP)">
        <OTPInput value={otp} onChangeText={setOtp} />
      </Section>

      <Section title="Form validation" description="react-hook-form + zod">
        <Card>
          <CardContent className="gap-3">
            <Controller
              control={control}
              name="email"
              render={({ field }) => (
                <Input
                  label="Email"
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={formState.errors.email?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field }) => (
                <Input
                  label="Password"
                  placeholder="••••••••"
                  secureTextEntry
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={formState.errors.password?.message}
                />
              )}
            />
            <Checkbox checked={agree} onCheckedChange={setAgree} />
            <Button
              label="Sign in"
              disabled={!agree}
              onPress={handleSubmit((values) =>
                toast({ title: 'Form valid', description: values.email, variant: 'success' }),
              )}
            />
          </CardContent>
        </Card>
      </Section>
    </PageWrapper>
  )
}
