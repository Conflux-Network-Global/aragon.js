import { fromEvent, from } from 'rxjs'
import { delay, filter } from 'rxjs/operators'
import { getConfiguration } from '../../configuration'
import * as configurationKeys from '../../configuration/keys'
import { getEventNames } from '../../utils/events'
const MAX_GAP = 1000000 - 1

export function call (request, proxy, wrapper) {
  const web3 = wrapper.web3
  const [
    address,
    methodAbiFragment,
    ...params
  ] = request.params

  const contract = new web3.eth.Contract(
    [methodAbiFragment],
    address
  )

  return contract.methods[methodAbiFragment.name](...params).call()
}

export async function intent (request, proxy, wrapper) {
  const [
    address,
    methodAbiFragment,
    ...params
  ] = request.params

  const transactionPath = await wrapper.getExternalTransactionPath(
    address,
    methodAbiFragment,
    params
  )

  return wrapper.performTransactionPath(transactionPath, { external: true })
}

export function events (request, proxy, wrapper) {
  const web3 = wrapper.web3
  const [
    address,
    jsonInterface
  ] = request.params

  const contract = new web3.eth.Contract(
    jsonInterface,
    address
  )

  // `external_events` RPC compatibility with aragonAPI versions:
  //   - aragonAPIv2: `'external_events', [address, jsonInterface, eventNames, eventOptions]`
  //   - aragonAPIv1: `'external_events', [address, jsonInterface, fromBlock (optional)]`
  let eventNames
  let eventOptions
  if (request.params.length === 4) {
    // aragonAPIv2
    eventNames = getEventNames(request.params[2])
    eventOptions = request.params[3]
  } else if (request.params.length <= 3) {
    // aragonAPIv1
    eventNames = ['allEvents']
    eventOptions = { fromBlock: request.params[2] }
  }
  // Use the app proxy's initialization block by default
  if (eventOptions.fromBlock == null) {
    eventOptions.fromBlock = proxy.initializationBlock
  }

  let eventSource
  if (eventNames.length === 1) {
    // Get a specific event or all events unfiltered
    eventSource = fromEvent(
      contract.events[eventNames[0]](eventOptions),
      'data'
    )
  } else {
    // Get all events and filter ourselves
    eventSource = fromEvent(
      contract.events.allEvents(eventOptions),
      'data'
    ).pipe(
      filter((event) => eventNames.includes(event.event))
    )
  }

  const eventDelay = getConfiguration(configurationKeys.SUBSCRIPTION_EVENT_DELAY) || 0
  // Small optimization: don't pipe a delay if we don't have to
  return eventDelay ? eventSource.pipe(delay(eventDelay)) : eventSource
}

export function pastEvents (request, proxy, wrapper) {
  const web3 = wrapper.web3
  const [
    address,
    jsonInterface
  ] = request.params

  const contract = new web3.eth.Contract(
    jsonInterface,
    address
  )

  console.log("wwww external pastEvents", request)

  // `external_past_events` RPC compatibility with aragonAPI versions:
  //   - aragonAPIv2: `'external_past_events', [address, jsonInterface, eventNames, eventOptions]`
  //   - aragonAPIv1: `'external_past_events', [address, jsonInterface, eventOptions]`
  let eventNames
  let eventOptions
  if (request.params.length === 4) {
    // aragonAPIv2
    eventNames = getEventNames(request.params[2])
    eventOptions = request.params[3]
  } else if (request.params.length === 3) {
    // aragonAPIv1
    eventNames = ['allEvents']
    eventOptions = request.params[2]
  }
  // Use the app proxy's initialization block by default
  if (eventOptions.fromBlock == null) {
    eventOptions.fromBlock = proxy.initializationBlock
  }

  const blockDiff = eventOptions.toBlock - eventOptions.fromBlock

  if (blockDiff > MAX_GAP) {
    const chunks = Math.floor(blockDiff / MAX_GAP)
    const lastChunk = blockDiff % MAX_GAP
    const firstFromBlock = eventOptions.fromBlock - ((chunks * MAX_GAP) + lastChunk)

    const o = [
      ...[...Array(chunks)].map((_, i) => ({
        ...eventOptions,
        fromBlock: firstFromBlock + ((i + 1) * MAX_GAP),
        toBlock: firstFromBlock + ((i + 1) * MAX_GAP) + MAX_GAP
      })),
      {
        ...eventOptions,
        fromBlock: eventOptions.fromBlock - lastChunk
      }]

    // The `from`s only unpack the returned Promises (and not the array inside them!)
    if (eventNames.length === 1) {
      // Get a specific event or all events unfiltered
      return from(...o.map((opts) =>
        contract.getPastEvents(eventNames[0], opts)))
    } else {
      // Get all events and filter ourselves
      return from(...o.map((opts) =>
          contract.getPastEvents('allEvents', opts)
            .then(events => events.filter(event => eventNames.includes(event.event)))
        )
      )
    }
  } else {
    // The `from`s only unpack the returned Promises (and not the array inside them!)
    if (eventNames.length === 1) {
      // Get a specific event or all events unfiltered
      return from(
        contract.getPastEvents(eventNames[0], eventOptions),
      )
    } else {
      // Get all events and filter ourselves
      return from(
        contract.getPastEvents('allEvents', eventOptions)
          .then(events => events.filter(event => eventNames.includes(event.event)))
      )
    }
  }
}
