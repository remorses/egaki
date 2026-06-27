// Framer component wrappers for egaki video scenes.
// Each wrapper imports the Responsive variant and renders it
// inside a full-frame container with the project's dark background.
import './framer/styles.css'

import HeroFramerComponent from './framer/hero'
import OverviewFramerComponent from './framer/overview'
import FeaturesFramerComponent from './framer/features'
import IntegrationsFramerComponent from './framer/integrations'
import BenefitsFramerComponent from './framer/benefits'
import AboutFramerComponent from './framer/about'
import ReviewsFramerComponent from './framer/reviews'
import PricingFramerComponent from './framer/pricing'
import ComplianceFramerComponent from './framer/compliance'
import FaqFramerComponent from './framer/faq'
import CtaFramerComponent from './framer/cta'

const sectionStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
}

export function Hero() {
  return (
    <div style={sectionStyle}>
      <HeroFramerComponent.Responsive />
    </div>
  )
}

export function Overview() {
  return (
    <div style={sectionStyle}>
      <OverviewFramerComponent.Responsive />
    </div>
  )
}

export function Features() {
  return (
    <div style={sectionStyle}>
      <FeaturesFramerComponent.Responsive />
    </div>
  )
}

export function Integrations() {
  return (
    <div style={sectionStyle}>
      <IntegrationsFramerComponent.Responsive />
    </div>
  )
}

export function Benefits() {
  return (
    <div style={sectionStyle}>
      <BenefitsFramerComponent.Responsive />
    </div>
  )
}

export function About() {
  return (
    <div style={sectionStyle}>
      <AboutFramerComponent.Responsive />
    </div>
  )
}

export function Reviews() {
  return (
    <div style={sectionStyle}>
      <ReviewsFramerComponent.Responsive />
    </div>
  )
}

export function Pricing() {
  return (
    <div style={sectionStyle}>
      <PricingFramerComponent.Responsive />
    </div>
  )
}

export function Compliance() {
  return (
    <div style={sectionStyle}>
      <ComplianceFramerComponent.Responsive />
    </div>
  )
}

export function Faq() {
  return (
    <div style={sectionStyle}>
      <FaqFramerComponent.Responsive />
    </div>
  )
}

export function Cta() {
  return (
    <div style={sectionStyle}>
      <CtaFramerComponent.Responsive />
    </div>
  )
}
