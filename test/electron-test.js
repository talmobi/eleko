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

// Module to create native browser window
const BrowserWindow = electron.BrowserWindow

// Keep a global ref of the window object, if you don't, the widow
// will be closed automatically when the JavaScript object
// is garbage collected
let mainWindow

async function createWindow ()
{
  // Create the browser window
  mainWindow = new BrowserWindow( {
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

  const session = mainWindow.webContents.session

  // set user-agent lowest compatible
  // set user-agent lowest compatible
  const userAgent = 'Mozilla/5.0 (https://github.com/talmobi/eleko)'
  session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/eleko)' )
  test( 'goto local index.html', async function ( t ) {
    t.plan( 1 )
    t.equal( userAgent, await session.getUserAgent(), 'user agent set OK' )
  } )


  test( 'goto local index.html', async function ( t ) {
    t.plan( 1 )

    const port = server.address().port
    const url = `http://127.0.0.1:${ port }/index.html`
    console.log( url )

    await eleko.goto( mainWindow, url )

    const title = await eleko.evaluate( mainWindow, function () {
      return document.title
    } )

    t.equal( title, 'Adorable baby giraffes' )
  } )

  test( 'evaluate title with string args', async function ( t ) {
    t.plan( 1 )

    await eleko.evaluate( mainWindow, function ( newTitle, selector ) {
      document[ selector ] = newTitle
    }, 'giraffe-title', 'title' )

    const title = await eleko.evaluate( mainWindow, function () {
      return document.title
    } )

    t.equal( title, 'giraffe-title' )
  } )

  test( 'evaluate title with object args', async function ( t ) {
    t.plan( 1 )

    await eleko.evaluate( mainWindow, function ( data ) {
      document[ data.selector ] = data.title
    }, { title: 'whale-title', selector: 'title' } )

    const title = await eleko.evaluate( mainWindow, function () {
      return document.title
    } )

    t.equal( title, 'whale-title' )
  } )

  test( 'waitFor string', async function ( t ) {
    t.plan( 3 )

    const now = Date.now()
    const text = await eleko.evaluate( mainWindow, function ( data ) {
      const el = document.querySelector( 'div[type=monkey]' )
      return el && el.textContent
    } )

    await eleko.evaluate( mainWindow, function ( data ) {
      triggerWaitFor( 'monkey' )
    } )

    await eleko.waitFor( mainWindow, 'div[type=monkey]' )

    // time waited
    const delta = Date.now() - now

    const newText = await eleko.evaluate( mainWindow, function ( data ) {
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
    const text = await eleko.evaluate( mainWindow, function ( data ) {
      const el = document.querySelector( 'div[type=whale]' )
      return el && el.textContent
    } )

    await eleko.evaluate( mainWindow, function ( data ) {
      triggerWaitFor( 'whale' )
    } )

    await eleko.waitFor( mainWindow, function () {
      const el = document.querySelector( 'div[type=whale]' )
      return !!el
    } )

    // time waited
    const delta = Date.now() - now

    const newText = await eleko.evaluate( mainWindow, function ( data ) {
      const el = document.querySelector( 'div[type=whale]' )
      return el && el.textContent
    } )

    t.ok( text === null || text === undefined, 'element did not exists yet OK' )
    t.equal( newText, 'whale text', 'element added later during waitFor OK' )
    t.ok( delta >= 1000 && delta < 2000, 'timed waited reasonable' )
  } )

  test( 'evaluate promise', async function ( t ) {
    t.plan( 2 )

    await eleko.evaluate( mainWindow, function ( newTitle, selector ) {
      document[ selector ] = newTitle
    }, 'before-promise-title', 'title' )

    const title = await eleko.evaluate( mainWindow, function () {
      return document.title
    } )

    await eleko.evaluate( mainWindow, function ( newTitle, selector ) {
      setTimeout( function () {
        document[ selector ] = newTitle
      }, 1000 )
    }, 'after-promise-title', 'title' )

    const newTitle = await eleko.evaluate( mainWindow, function () {
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

  // Open the DevTools
  // mainWindow.webContents.openDevTools()

  // Emitted when the window is closed
  mainWindow.on( 'closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element
    mainWindow = null
  } )
}

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

app.on( 'activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if ( mainWindow === null ) {
    createWindow()
  }
})
