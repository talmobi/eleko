// test eleko electron helper functions

const test = require( 'tape' )

const electron = require( 'electron' )

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

process.on( 'uncaughtException', function ( error ) {
  console.log( ' === uncaughtException === ' )

  try {
    app.quit()
    console.log( 'exited electron app' )
  } catch ( err ) {
    /* ignore */
  }

  console.log( error )

  process.exit( 1 )
} )

// Module to control application life
const app = electron.app

app.allowRendererProcessReuse = true

app.disableHardwareAcceleration()

// app.commandLine.appendSwitch( 'use-gl', 'swiftshader' )
// app.commandLine.appendSwitch( 'ignore-gpu-blacklist' )

// hide dock icon by default
app.dock && app.dock.hide && app.dock.hide()

// Module to create native browser window
const BrowserWindow = electron.BrowserWindow

let page, session

const userAgent = 'Mozilla/5.0 (https://github.com/talmobi/eleko)'

async function createWindow ()
{
  // Create the browser window
  page = await eleko.newPage( {
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      autoplayPolicy: [ 'no-user-gesture-required', 'user-gesture-required', 'document-user-activation-required' ][ 2 ],

      // javascript: false,
      images: false,
      webgl: false,

      nodeIntegration: false,
      webviewTag: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // preload: path.join( __dirname, 'preload.js' )
    }
  } )

  session = page.win.webContents.session

  session.setUserAgent( userAgent )

  // Open the DevTools
  // page.win.webContents.openDevTools()

  return page
}

test( 'create window', async function ( t ) {
  t.plan( 1 )
  const p = await createWindow()
  t.equal( p, page )
} )

test( 'goto local index.html', async function ( t ) {
  t.plan( 1 )
  t.equal( userAgent, await session.getUserAgent(), 'user agent set OK' )
} )

test( 'goto local index.html', async function ( t ) {
  t.plan( 1 )

  const port = server.address().port
  const url = `http://127.0.0.1:${ port }/index.html`
  console.log( url )

  console.log( 'going goto' )
  await page.goto( url )
  console.log( 'done goto' )

  const title = await eleko.evaluate( page.win, function () {
    return document.title
  } )

  t.equal( title, 'Adorable baby giraffes' )
} )

test( 'evaluate title with string args', async function ( t ) {
  t.plan( 1 )

  await eleko.evaluate( page.win, function ( newTitle, selector ) {
    document[ selector ] = newTitle
  }, 'giraffe-title', 'title' )

  const title = await eleko.evaluate( page.win, function () {
    return document.title
  } )

  t.equal( title, 'giraffe-title' )
} )

test( 'evaluate title with object args', async function ( t ) {
  t.plan( 1 )

  await eleko.evaluate( page.win, function ( data ) {
    document[ data.selector ] = data.title
  }, { title: 'whale-title', selector: 'title' } )

  const title = await eleko.evaluate( page.win, function () {
    return document.title
  } )

  t.equal( title, 'whale-title' )
} )

test( 'waitFor string', async function ( t ) {
  t.plan( 3 )

  const now = Date.now()
  const text = await eleko.evaluate( page.win, function ( data ) {
    const el = document.querySelector( 'div[type=monkey]' )
    return el && el.textContent
  } )

  await eleko.evaluate( page.win, function ( data ) {
    triggerWaitFor( 'monkey' )
  } )

  await eleko.waitFor( page.win, 'div[type=monkey]' )

  // time waited
  const delta = Date.now() - now

  const newText = await eleko.evaluate( page.win, function ( data ) {
    const el = document.querySelector( 'div[type=monkey]' )
    return el && el.textContent
  } )

  t.ok( text === null || text === undefined, 'element did not exists yet OK' )
  t.equal( newText, 'monkey text', 'element added later during waitFor OK' )
  t.ok( delta >= 1000 && delta < 2000, 'timed waited reasonable' )
} )

test( 'waitFor function', async function ( t ) {
  t.plan( 3 )

  const now = Date.now()
  const text = await eleko.evaluate( page.win, function ( data ) {
    const el = document.querySelector( 'div[type=whale]' )
    return el && el.textContent
  } )

  await eleko.evaluate( page.win, function ( data ) {
    triggerWaitFor( 'whale' )
  } )

  await eleko.waitFor( page.win, function () {
    const el = document.querySelector( 'div[type=whale]' )
    return !!el
  } )

  // time waited
  const delta = Date.now() - now

  const newText = await eleko.evaluate( page.win, function ( data ) {
    const el = document.querySelector( 'div[type=whale]' )
    return el && el.textContent
  } )

  t.ok( text === null || text === undefined, 'element did not exists yet OK' )
  t.equal( newText, 'whale text', 'element added later during waitFor OK' )
  t.ok( delta >= 1000 && delta < 2000, 'timed waited reasonable' )
} )

test( 'evaluate promise', async function ( t ) {
  t.plan( 2 )

  await eleko.evaluate( page.win, function ( newTitle, selector ) {
    document[ selector ] = newTitle
  }, 'before-promise-title', 'title' )

  const title = await eleko.evaluate( page.win, function () {
    return document.title
  } )

  await eleko.evaluate( page.win, function ( newTitle, selector ) {
    setTimeout( function () {
      document[ selector ] = newTitle
    }, 1000 )
  }, 'after-promise-title', 'title' )

  const newTitle = await eleko.evaluate( page.win, function () {
    return new Promise( function ( resolve, reject ) {
      setTimeout( function () {
        resolve( document.title )
      }, 1000 )
    } )
  } )

  t.equal( title, 'before-promise-title' )
  t.equal( newTitle, 'after-promise-title' )
} )

test( 'close test http server', function ( t ) {
  t.plan( 1 )

  server.close( function () {
    t.pass( 'server closed' )
  } )
} )

test.onFinish( function () {
  app.quit()
} )

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs
app.on( 'ready', async function () {
  createWindow()
} )

// Quit when all windows are closed.
app.on( 'window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  // if ( process.platform !== 'darwin' ) {
  //    app.quit()
  // }

  app.quit()
})
