// test eleko.launch browser API

const test = require( 'tape' )

const fs = require( 'fs' )
const path = require( 'path' )
const url = require( 'url' )

const eleko = require( '../index.js' )

const http = require( 'http' )
const express = require( 'express' )
const expressApp = express()
const server = http.createServer( expressApp )

// get available TCP port
const getPort = require( 'get-port' )

test( 'init local test http server', async function ( t ) {
  t.plan( 1 )

  const port = await getPort()
  const host = '127.0.0.1' // self only ( e.g. not 0.0.0.0 )

  // serve our static test files
  expressApp.use( express.static( path.join( __dirname, 'stage' ) ) )

  server.listen( port, host, function () {
    const address = server.address()
    const url = `http://127.0.0.1:${ address.port }/index.html`
    console.log( url )
    t.equal( address.port, port, 'local test http server running' )
  } )
} )

let _browser
let _page
test( 'launch', async function ( t ) {
  t.timeoutAfter( 8000 )
  t.plan( 2 )

  const browser = await eleko.launch()
  t.ok( browser.spawn.pid )

  browser.on( 'error', function ( err ) {
    throw err
  } )

  // browser.on( 'exit', function ( code ) {
  //   t.end()
  // } )

  const page = await browser.newPage(
    {
      // show: true,
      webPreferences: {
        images: true
      }
    }
  )

  _browser = browser
  _page = page

  // set user-agent lowest compatible
  const now = Date.now()
  const userAgent = 'Mozilla/5.0 ( ' + now + ' )'
  console.log( 'setUserAgent..' )
  await page.setUserAgent( userAgent )
  console.log( 'setUserAgent' )

  t.equal( userAgent, await page.getUserAgent(), 'user agent set OK' )
} )

test( 'goto local index.html', async function ( t ) {
  // goto local index.html
  t.plan( 1 )
  const port = server.address().port
  const url = `http://127.0.0.1:${ port }/index.html`
  console.log( 'url: ' + url )
  await _page.goto( url )

  const title = await _page.evaluate( function () {
    return document.title
  } )

  t.equal( title, 'Adorable baby giraffes', 'goto local index.html' )
} )

test( 'userAgent remains after goto', async function ( t ) {
  // goto local index.html
  t.plan( 1 )
  const port = server.address().port
  const url = `http://127.0.0.1:${ port }/index.html`
  console.log( 'url: ' + url )

  const ua = await _page.getUserAgent()
  await _page.goto( url )

  t.equal( ua, await _page.getUserAgent(), 'user agent remained after goto OK' )
} )

test( 'evaluate title with string args', async function ( t ) {
  // evaluate title with string args
  t.plan( 1 )

  await _page.evaluate( function ( newTitle, selector ) {
    document[ selector ] = newTitle
  }, 'giraffe-title', 'title' )

  const title = await _page.evaluate( function () {
    return document.title
  } )

  t.equal( title, 'giraffe-title', 'evaluate title with string args' )
} )

test( 'evaluate title with object args', async function ( t ) {
  // evaluate title with object args
  t.plan( 1 )
  await _page.evaluate( function ( data ) {
    document[ data.selector ] = data.title
  }, { title: 'whale-title', selector: 'title' } )

  const title = await _page.evaluate( function () {
    return document.title
  } )

  t.equal( title, 'whale-title' )
} )

test( 'waitFor string', async function ( t ) {
  // waitFor string
  t.plan( 3 )

  const now = Date.now()
  const text = await _page.evaluate( function ( data ) {
    const el = document.querySelector( 'div[type=monkey]' )
    return el && el.textContent
  } )

  await _page.evaluate( function ( data ) {
    triggerWaitFor( 'monkey' )
  } )

  await _page.waitFor( 'div[type=monkey]' )

  // time waited
  const delta = Date.now() - now

  const newText = await _page.evaluate( function ( data ) {
    const el = document.querySelector( 'div[type=monkey]' )
    return el && el.textContent
  } )

  t.ok( text === null || text === undefined, 'element did not exists yet OK' )
  t.equal( newText, 'monkey text', 'element added later during waitFor OK' )
  t.ok( delta >= 1000 && delta < 2000, 'timed waited reasonable' )
} )

test( 'waitFor function', async function ( t ) {
  // waitFor function
  t.plan( 3 )

  const now = Date.now()
  const text = await _page.evaluate( function ( data ) {
    const el = document.querySelector( 'div[type=whale]' )
    return el && el.textContent
  } )

  await _page.evaluate( function ( data ) {
    triggerWaitFor( 'whale' )
  } )

  await _page.waitFor( function () {
    const el = document.querySelector( 'div[type=whale]' )
    return !!el
  } )

  // time waited
  const delta = Date.now() - now

  const newText = await _page.evaluate( function ( data ) {
    const el = document.querySelector( 'div[type=whale]' )
    return el && el.textContent
  } )

  t.ok( text === null || text === undefined, 'element did not exists yet OK' )
  t.equal( newText, 'whale text', 'element added later during waitFor OK' )
  t.ok( delta >= 1000 && delta < 2000, 'timed waited reasonable' )
} )

test( 'evaluate promise', async function ( t ) {
  // evaluate promise
  t.plan( 2 )

  await _page.evaluate( function ( newTitle, selector ) {
    document[ selector ] = newTitle
  }, 'before-promise-title', 'title' )

  const title = await _page.evaluate( function () {
    return document.title
  } )

  await _page.evaluate( function ( newTitle, selector ) {
    setTimeout( function () {
      document[ selector ] = newTitle
    }, 1000 )
  }, 'after-promise-title', 'title' )

  const newTitle = await _page.evaluate( function () {
    return new Promise( function ( resolve, reject ) {
      setTimeout( function () {
        resolve( document.title )
      }, 1000 )
    } )
  } )

  t.equal( title, 'before-promise-title' )
  t.equal( newTitle, 'after-promise-title' )
} )

test( 'page.onrequest', async function ( t ) {
  t.timeoutAfter( 1000 * 10 )
  t.plan( 8 + 3 + 3 + 1 ) // +3 for every onrequest handler

  // goto local index.html
  const port = server.address().port
  const url = `http://127.0.0.1:${ port }/images.html`
  console.log( 'url: ' + url )

  let dragoniteCounter = 0
  let tideAdCounter = 0

  _page.onrequest = function ( req ) {
    console.log( ' == MONKEY ON REQUEST == ' )
    console.log( 'url: ' + req.url  )
    t.pass( 'MONKEY REQUEST CALLED' )

    const url = req.url
    if ( url.indexOf( 'dragonite.gif' ) >= 0 ) dragoniteCounter++
    if ( url.indexOf( 'tide-ad.gif' ) >= 0 ) tideAdCounter++

    req.continue()
  }

  await _page.goto( url )
  console.log( ' == FIRST GOTO DONE == ' )

  await new Promise( function ( r ) { setTimeout( r, 1000 ) } )

  let data
  data = await _page.evaluate( function () {
    const dragonite = document.getElementById( 'dragonite' )
    const tideAd = document.getElementById( 'tide-ad' )

    return {
      dragonite: {
        onLoadCalled: !!dragonite.onLoadCalled,
        onErrorCalled: !!dragonite.onErrorCalled
      },
      tideAd: {
        onLoadCalled: !!tideAd.onLoadCalled,
        onErrorCalled: !!tideAd.onErrorCalled
      }
    }
  } )

  t.ok( data.dragonite.onLoadCalled, 'dragonite loaded' )
  t.notOk( data.dragonite.onErrorCalled, 'dragonite error-free' )

  t.ok( data.tideAd.onLoadCalled, 'tideAd loaded' )
  t.notOk( data.tideAd.onErrorCalled, 'tideAd error-free' )

  _page.onrequest = function ( req ) {
    console.log( ' == GIRAFFE ON REQUEST == ' )
    console.log( 'url: ' + req.url  )
    t.pass( 'GIRAFFE REQUEST CALLED' )

    const url = req.url
    if ( url.indexOf( 'dragonite.gif' ) >= 0 ) dragoniteCounter++
    if ( url.indexOf( 'tide-ad.gif' ) >= 0 ) tideAdCounter++

    if ( url.indexOf( 'tide-ad.gif' ) >= 0 ) return req.abort()

    req.continue()
  }

  await _page.goto( url )
  console.log( ' == SECOND GOTO DONE == ' )

  await new Promise( function ( r ) { setTimeout( r, 1000 ) } )

  data = await _page.evaluate( function () {
    const dragonite = document.getElementById( 'dragonite' )
    const tideAd = document.getElementById( 'tide-ad' )

    return {
      dragonite: {
        onLoadCalled: !!dragonite.onLoadCalled,
        onErrorCalled: !!dragonite.onErrorCalled
      },
      tideAd: {
        onLoadCalled: !!tideAd.onLoadCalled,
        onErrorCalled: !!tideAd.onErrorCalled
      }
    }
  } )

  t.ok( data.dragonite.onLoadCalled, 'dragonite loaded' )
  t.notOk( data.dragonite.onErrorCalled, 'dragonite error-free' )

  // NOTE tile-ad should not have loaded this time
  t.notOk( data.tideAd.onLoadCalled, 'tideAd did not load' )
  t.ok( data.tideAd.onErrorCalled, 'tideAd has errors' )

  // clear request handler at end
  _page.onrequest = undefined
  t.equal( _page.onrequest, undefined )
} )

test( 'page.on( "request", ... )', async function ( t ) {
  t.timeoutAfter( 1000 * 10 )
  t.plan( 8 + 3 + 3 + 1 ) // +3 for every onrequest handler

  // goto local index.html
  const port = server.address().port
  const url = `http://127.0.0.1:${ port }/images.html`
  console.log( 'url: ' + url )

  let dragoniteCounter = 0
  let tideAdCounter = 0

  let offOnRequest = _page.on( 'request', function ( req ) {
    console.log( ' == MONKEY ON REQUEST == ' )
    console.log( 'url: ' + req.url  )
    t.pass( 'MONKEY REQUEST CALLED' )

    const url = req.url
    if ( url.indexOf( 'dragonite.gif' ) >= 0 ) dragoniteCounter++
    if ( url.indexOf( 'tide-ad.gif' ) >= 0 ) tideAdCounter++

    req.continue()
  } )

  await _page.goto( url )
  console.log( ' == FIRST GOTO DONE == ' )

  await new Promise( function ( r ) { setTimeout( r, 1000 ) } )

  let data
  data = await _page.evaluate( function () {
    const dragonite = document.getElementById( 'dragonite' )
    const tideAd = document.getElementById( 'tide-ad' )

    return {
      dragonite: {
        onLoadCalled: !!dragonite.onLoadCalled,
        onErrorCalled: !!dragonite.onErrorCalled
      },
      tideAd: {
        onLoadCalled: !!tideAd.onLoadCalled,
        onErrorCalled: !!tideAd.onErrorCalled
      }
    }
  } )

  t.ok( data.dragonite.onLoadCalled, 'dragonite loaded' )
  t.notOk( data.dragonite.onErrorCalled, 'dragonite error-free' )

  t.ok( data.tideAd.onLoadCalled, 'tideAd loaded' )
  t.notOk( data.tideAd.onErrorCalled, 'tideAd error-free' )

  offOnRequest() // remove previous handler first
  offOnRequest = _page.on( 'request', function ( req ) {
    console.log( ' == GIRAFFE ON REQUEST == ' )
    console.log( 'url: ' + req.url  )
    t.pass( 'GIRAFFE REQUEST CALLED' )

    const url = req.url
    if ( url.indexOf( 'dragonite.gif' ) >= 0 ) dragoniteCounter++
    if ( url.indexOf( 'tide-ad.gif' ) >= 0 ) tideAdCounter++

    if ( url.indexOf( 'tide-ad.gif' ) >= 0 ) return req.abort()

    req.continue()
  } )

  await _page.goto( url )
  console.log( ' == SECOND GOTO DONE == ' )

  await new Promise( function ( r ) { setTimeout( r, 1000 ) } )

  data = await _page.evaluate( function () {
    const dragonite = document.getElementById( 'dragonite' )
    const tideAd = document.getElementById( 'tide-ad' )

    return {
      dragonite: {
        onLoadCalled: !!dragonite.onLoadCalled,
        onErrorCalled: !!dragonite.onErrorCalled
      },
      tideAd: {
        onLoadCalled: !!tideAd.onLoadCalled,
        onErrorCalled: !!tideAd.onErrorCalled
      }
    }
  } )

  t.ok( data.dragonite.onLoadCalled, 'dragonite loaded' )
  t.notOk( data.dragonite.onErrorCalled, 'dragonite error-free' )

  // NOTE tile-ad should not have loaded this time
  t.notOk( data.tideAd.onLoadCalled, 'tideAd did not load' )
  t.ok( data.tideAd.onErrorCalled, 'tideAd has errors' )

  // clear request handler at end
  offOnRequest()
  t.equal( _page.onrequest, undefined )
} )

test( 'close test http server', async function ( t ) {
  // close test http server
  t.plan( 1 )

  server.close( function () {
    t.pass( 'server closed' )
  } )
} )

test( 'close browser', async function ( t ) {
  t.plan( 1 )

  _browser.on( 'exit', function () {
    t.pass()
  } )

  await _browser.close()
} )

test.onFailure( async function () {
  try {
    await server.close()
  } catch ( err ) {}
  try {
    await _browser.close()
  } catch ( err ) {}
  process.exit( 1 )
} )

test.onFinish( async function () {
  try {
    await server.close()
  } catch ( err ) {}
  try {
    await _browser.close()
  } catch ( err ) {}
  process.exit()
} )
