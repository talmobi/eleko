const fs = require( 'fs' )
const path = require( 'path' )
const url = require( 'url' )

const eeto = require( 'eeto' )

const _nz = require( 'nozombie' )()
const functionToString = require( 'function-to-string' )
const { serializeError, deserializeError } = require( 'serialize-error' )

const _envs = {}
Object.keys( process.env ).forEach(
  function ( key ) {
    const n = process.env[ key ]
    if ( n == '0' || n == 'false' || !n ) {
      return _envs[ key ] = false
    }
    _envs[ key ] = n
  }
)

function debugLog ( ...args ) {
  if ( !_envs.debug ) return
  console.log.apply( this, args )
}

process.on( 'uncaughtException', onExit )
process.on( 'exit', onExit )

function onExit ( err ) {
  console.log( 'eleko exited' )
  if ( err ) console.log( err )

  if ( onExit.done ) return
  onExit.done = true
  _nz.kill()
}

const api = eeto()

module.exports = api

api.launch = launch

api.goto = goto
api.waitFor = waitFor
api.evaluate = evaluate
api.setUserAgent = setUserAgent
api.getUserAgent = getUserAgent
api.onrequest = onrequest

api.getDefaultOptions = getDefaultOptions

const WAITFOR_TIMEOUT_TIME = 1000 * 30 // 30 seconds
const POLL_INTERVAL = 200 // milliseconds
const LAUNCH_TIMEOUT_TIME = 10 * 1000

// TODO add software rendering opts
// ref: https://swiftshader.googlesource.com/SwiftShader
// ref: https://github.com/google/swiftshader
const DEFAULT_OPTS = {
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

    // preload: path.join( __dirname, 'electron-preload.js' )
    preload: undefined
  }
}

function getDefaultOptions ()
{
  return Object.assign( {}, DEFAULT_OPTS )
}

function launch ( options )
{
  return new Promise( function ( browserResolve, browserReject ) {
    // path to electron executable in node context
    const _electron = require( 'electron' )

    if ( typeof _electron !== 'string' ) {
      debugLog( 'not a string' )
      throw new Error(`
        Error: trying to spawn electron inside of an existing electron context.
        Spawn from within a node context instead.
          ex. 'node index.js'
      `)
    }

    const _childProcess = require( 'child_process' )

    const _path = require( 'path' )

    // file to be run with electron
    const filepath = path.join( __dirname, 'electron-main.js' )

    let _messageId = 1
    const _promiseMap = {}

    const browser = eeto()
    browser._pages = []

    let exitTimeout
    let exitPromiseId
    browser.close = browser.exit = browser.quit = function () {
      let _resolve, _reject
      const _promise = new Promise( function ( resolve, reject ) {
        _resolve = resolve
        _reject = reject
      } )

      exitTimeout = setTimeout( function () {
        _nz.kill()
      }, 1000 * 3 )

      const messageId = _messageId++
      exitPromiseId = messageId
      const json = {
        type: 'app',
        query: 'quit',
        messageId: messageId
      }

      _promiseMap[ messageId ] = {
        promise: _promise,
        resolve: _resolve,
        reject: _reject
      }

      spawn.stdin.write( JSON.stringify( json ) + '\n' )

      return _promise
    }

    browser.pages = function () {
      const messageId = _messageId++

      let _resolve, _reject
      const _promise = new Promise( function ( resolve, reject ) {
        _resolve = resolve
        _reject = reject
      } )

      _promiseMap[ messageId ] = {
        promise: _promise,
        resolve: _resolve,
        reject: _reject
      }

      const json = {
        type: 'browser:pages',
        messageId: messageId
      }

      spawn.stdin.write( JSON.stringify( json ) + '\n' )

      return _promise
    }

    browser.newPage = function ( options ) {
      const messageId = _messageId++

      let _resolve, _reject
      const _promise = new Promise( function ( resolve, reject ) {
        _resolve = resolve
        _reject = reject
      } )

      _promiseMap[ messageId ] = {
        promise: _promise,
        resolve: _resolve,
        reject: _reject
      }

      const json = {
        type: 'browser:newPage',
        messageId: messageId,
        options: options
      }

      spawn.stdin.write( JSON.stringify( json ) + '\n' )

      return _promise
    }

    function infectPage ( eleko_data ) {
      const page = eeto()
      page.pageIndex = eleko_data.pageIndex

      // attach eleko helper fns
      ;[
        'goto',
        'waitFor',
        'evaluate',
        'setUserAgent',
        'getUserAgent'
      ].forEach( function ( name ) {
        page[ name ] = function ( ...args ) {
          const messageId = _messageId++

          let _resolve, _reject
          const _promise = new Promise( function ( resolve, reject ) {
            _resolve = resolve
            _reject = reject
          } )

          _promiseMap[ messageId ] = {
            promise: _promise,
            resolve: _resolve,
            reject: _reject
          }

          const json = {
            type: 'page:eleko',
            pageIndex: page.pageIndex,
            messageId: messageId,

            query: name,
            args: args.map( function ( arg ) {
              return encodeArg( arg )
            } )
          }

          spawn.stdin.write( JSON.stringify( json ) + '\n' )

          return _promise
        }
      } )

      page.call = function call ( ...args ) {
        const messageId = _messageId++

        let _resolve, _reject
        const _promise = new Promise( function ( resolve, reject ) {
          _resolve = resolve
          _reject = reject
        } )

        _promiseMap[ messageId ] = {
          promise: _promise,
          resolve: _resolve,
          reject: _reject
        }

        const json = {
          type: 'page:query',
          pageIndex: page.pageIndex,
          messageId: messageId,

          query: args[ 0 ],
          args: args.slice( 1 ).map( function ( arg ) {
            return encodeArg( arg )
          } )
        }

        spawn.stdin.write( JSON.stringify( json ) + '\n' )

        return _promise
      }

      return page
    }

    const _env = Object.assign( {}, process.env, { launched_with_eleko: true } )
    const spawn = _childProcess.spawn( _electron, [ filepath ], { stdio: 'pipe', shell: false, env: _env } )
    _nz.add( spawn.pid )
    browser.spawn = spawn

    let _buffer = ''
    spawn.stdout.on( 'data', function ( chunk ) {
      _buffer += chunk
      _processBuffer()
    } )

    function _processBuffer () {
      const lines = _buffer.split( '\n' )
      _buffer = lines.pop()
      // debugLog( '_buffer.length: ' + _buffer.length )

      for ( let i = 0; i < lines.length; i++ ) {
        const line = lines[ i ]
        handleLine( line )
      }
    }

    function handleLine ( line ) {
      let json

      try {
        json = JSON.parse( line )
      } catch ( err ) {
        return console.log( line )
      }

      // handle error
      {
        const messageId = json.messageId
        const p = _promiseMap[ messageId ]
        const error = json.error
        if ( error ) return p.reject( deserializeError( error ) )
      }

      switch ( json.type ) {
        // generic resolve
        case 'resolve':
          {
            const messageId = json.messageId
            const value = json.value

            const p = _promiseMap[ messageId ]
            p.resolve( value )
          }
          break

        case 'app-ready':
          return browserResolve( browser )

        case 'browser:pages:response':
          {
            const pageIndex = json.pageIndex
            const messageId = json.messageId

            const p = _promiseMap[ messageId ]
            p.resolve( json.pages.map( function ( page ) {
              return infectPage( page )
            } ) )
          }
          break

        case 'browser:newPage:response':
          {
            const pageIndex = json.pageIndex
            const messageId = json.messageId

            const p = _promiseMap[ messageId ]
            const page = infectPage( json.newPage )

            browser._pages.push( page )
            p.resolve( page )
          }
          break

        case 'page:request':
          {
            debugLog( 'eleko page:request' )

            const pageIndex = json.pageIndex
            const messageId = json.messageId

            const page = browser._pages.find( function ( page ) { return page.pageIndex === pageIndex } )

            const _timeout = setTimeout( function () {
              throw Error(`
                  .onrequest -- timed out!
                  Did you forget to call req.abort() or req.continue() ?
                  You can disable this error by calling req.ignore()
                `)
            }, 3000 )

            const req = json.details
            req.abort = function () {
              clearTimeout( _timeout )
              debugLog( 'eleko page:request abort()' )

              const response = {
                type: 'resolve',
                messageId: json.messageId,
                value: true
              }

              spawn.stdin.write( JSON.stringify( response ) + '\n' )
            }
            req.continue = function () {
              clearTimeout( _timeout )
              debugLog( 'eleko page:request continue()' )

              const response = {
                type: 'resolve',
                messageId: json.messageId,
                value: false
              }

              spawn.stdin.write( JSON.stringify( response ) + '\n' )
            }
            req.ignore = function () {
              clearTimeout( _timeout )
            }

            // TODO should not happen, throw error?
            // if ( !page ) return req.continue()
            if ( !page ) throw new Error( 'page was undefined' )

            // if nobody is listening, default req.continue()
            const l = page._listeners[ 'request' ] || []
            if ( l.length <= 0 ) return req.continue()

            page.emit( 'request', req  )
          }
          break

        case 'page:close':
          {
            const pageIndex = json.pageIndex
            const messageId = json.messageId

            const page = browser._pages.find( function ( page ) { return page.pageIndex === pageIndex } )
            page.emit( 'close' )

            const i = browser._pages.indexOf( page )
            browser._pages.splice( i, 1 )
          }
          break

        case 'console.log':
          {
            const args = json.args
            // debugLog.apply( this, args )
            console.log.apply( this, args )
          }
          break

        case 'error':
          {
            // TODO fix never called because of error handler
            // above
            const error = deserializeError( json.error )
            console.log.apply( this, error )
            browser.emit( 'exit', error )
          }
          break

        default:
          // unknown type
          console.log( 'eleko unknown type: ' + line )
      }
    }

    spawn.on( 'exit', function ( code ) {
      if ( exitPromiseId ) {
        const p = _promiseMap[ exitPromiseId ]
        exitPromiseId = undefined
        p.resolve()
      }

      console.log( 'electron spawn exited, code: ' + code )
      clearTimeout( exitTimeout )
      browser.emit( 'exit', code )
    } )
  } )
}

function createWindow ( electron, _options )
{
  if ( typeof electron === 'string' ) {
    throw new Error(`
      Error: trying to launch outide of electron context.
      You need to run with the electron binary instead of node.
        ex. 'electron main.js'
        ex. 'node_modules/.bin/electron main.js'
    `)
  }

  // Module to control application life
  const app = electron.app

  process.on( 'uncaughtException', function ( error ) {
    debugLog( ' === uncaughtException === ' )

    try {
      app.quit()
      debugLog( 'exited electron app' )
    } catch ( err ) {
      /* ignore */
    }

    debugLog( error )

    process.exit( 1 )
  } )

  // Module to create native browser window
  const BrowserWindow = electron.BrowserWindow

  return new Promise( function ( resolve, reject ) {
    let _stage = 'pollReadyState'
    let _done = false
    const _timeout = setTimeout( function () {
      if ( _done ) return
      _done = true
      reject( 'error: timed out launch at ' + _stage + ' stage' )
    }, LAUNCH_TIMEOUT_TIME )

    // can't reall attach app.on( 'ready' ) listener because it
    // might already have been called
    pollReadyState()

    function pollReadyState () {
      if ( _done ) return
      debugLog( 'pollReadyState' )

      if ( app.isReady() ) {
        onReady()
      } else {
        setTimeout( pollReadyState, 33 )
      }
    }

    function onReady () {
      debugLog( 'onReady' )

      _stage = 'onReady new BrowserWindow'
      // Create the browser window
      const opts = Object.assign( getDefaultOptions(), _options || {} )
      let mainWindow = new BrowserWindow( opts )

      const session = mainWindow.webContents.session

      // set user-agent lowest compatible
      session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/eleko)' )

      _stage = 'finish'
      finish()
      function finish () {
        debugLog( 'finish' )
        if ( _done ) {
          // we already timed out and yet now the window is ready,
          // should rarely happen
          debugLog( 'warning: launch finished but was timed out earlier (launch timeout too short?)' )
          mainWindow = undefined
          return
        }
        _done = true

        clearTimeout( _timeout )
        resolve( mainWindow )
      }
    }
  } )
}

function setUserAgent ( mainWindow )
{
  const session = mainWindow.webContents.session

  // set user-agent lowest compatible
  session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/eleko)' )
}

function getUserAgent ( mainWindow )
{
  const session = mainWindow.webContents.session

  // set user-agent lowest compatible
  return session.getUserAgent()
}

// mainWindow[, options], query[, ...args])
function waitFor ( mainWindow, query, ...args )
{
  let opts = {}
  if ( typeof query === 'object' ) {
    opts = query
    query = args[ 0 ]
    args = args.slice( 1 )
  }

  if ( typeof query === 'object' ) {
    throw new Error(
      'query must be a string, number or function\n' +
      'function waitFor( mainWindow[, options], query[, ...args] )'
    )
  }

  return new Promise ( function ( resolve, reject ) {
    if ( typeof query === 'number' ) {
      return setTimeout( resolve, query )
    }

    let fnString
    if ( typeof query === 'string' ) {
      fnString = (`
        ;(function () {
          /* console.log( ' === waitFor === ' ) */
          return !!document.querySelector( '${ query }' )
        })()
      `)
    } else {
      if ( typeof query !== 'function' ) {
        throw new Error(
          'query must be a string, number or function\n' +
          'function waitFor( mainWindow[, options], query[, ...args] )'
        )
      }
      fnString = parseFunction( query, args )
    }

    const startTime = Date.now()

    function callback ( result ) {
      debugLog( ' === callback === ' )

      if ( result ) {
        return resolve()
      }

      const ms = Number( opts.polling ) || POLL_INTERVAL

      setTimeout( next, ms )
    }

    next()

    async function next () {
      debugLog( ' === next === ' )

      const now = Date.now()
      const delta = ( now - startTime )
      if ( delta > WAITFOR_TIMEOUT_TIME ) {
        return reject( 'error: timed out waitFor' )
      }

      try {
        const p = await mainWindow.webContents.executeJavaScript(
          fnString,
          true
        )
        callback( p )
      } catch ( err ) {
        reject( err )
      }
    }
  } )
}

function goto ( mainWindow, url )
{
  debugLog( ' === goto === ' )
  debugLog( 'url: ' + url )

  return new Promise( async function ( resolve, reject ) {
    try {
      const id = 'eleko-page-reload-checker:' + Date.now()

      const currentURL = ( await mainWindow.getURL() ) || ''
      if ( !( currentURL.trim() ) ) {
        debugLog( 'loading about:blank' )
        await mainWindow.loadURL( 'about:blank' )
      }

      await waitFor( mainWindow, { polling: 33 }, function () {
        return !!document.location
      } )

      debugLog( ' >> goto setup href << ' )
      await evaluate( mainWindow, function ( id, url ) {
        const el = document.createElement( 'div' )
        el.id = id
        document.body.appendChild( el )
        document.location.href = url
      }, id, url )

      debugLog( ' >> goto waiting  << ' )
      await waitFor( mainWindow, { polling: 33 }, function ( id ) {
        const el = document.getElementById( id )
        return document.body && !el
      }, id )

      debugLog( ' >> GOTO DONE << ' )
      resolve()
    } catch ( err ) {
      reject( err )
    }
  } )
}

function evaluate ( mainWindow, fn, ...args )
{
  debugLog( ' === evaluate === ' )

  const fnString = parseFunction( fn, args )

  return new Promise( async function ( resolve, reject ) {
    try {
      const p = await mainWindow.webContents.executeJavaScript(
        fnString,
        true
      )
      resolve( p )
    } catch ( err ) {
      reject( err )
    }
  } )
}

function parseFunction ( fn, args )
{
  const fnString = fn.toString()

  args = args || []
  args = args.map( function ( arg ) { return JSON.stringify( arg ) } )

  const wrapped = (`
    ;(${ fnString })(${ args.join( ',' ) });
  `)

  debugLog( ' === parseFunction begin === ' )
  if ( wrapped.length < 100 ) {
    debugLog( wrapped )
  } else {
    debugLog( wrapped.slice( 0, 60 ) + '...' )
  }
  debugLog( ' === parseFunction end === ' )

  return wrapped
}

function onrequest ( mainWindow, listener )
{
  const session = mainWindow.webContents.session

  // attach request handler
  session.webRequest.onBeforeRequest(
    async function ( details, callback ) {
      const req = details
      const url = details.url

      // special case always allow devtools
      if ( url.indexOf( 'devtools' )  === 0 ) {
        return callback( { cancel: false } )
      }

      const _timeout = setTimeout( function () {
        throw Error(`
            .onrequest -- timed out!
            Did you forget to call req.abort() or req.continue() ?
            You can disable this error by calling req.ignore()
          `)
      }, 3000 )

      req.abort = function () {
        clearTimeout( _timeout )
        return callback( { cancel: true } )
      }
      req.continue = function () {
        clearTimeout( _timeout )
        return callback( { cancel: false } )
      }
      req.ignore = function () {
        clearTimeout( _timeout )
      }

      listener( req )
    }
  )
}

function encodeArg ( arg )
{
  const type = typeof arg
  let content
  if ( type === 'object' || type === 'boolean' ) {
    content = JSON.stringify( arg )
  } else if ( type === 'string' ) {
    content = arg
  } else if ( type === 'number' ) {
    content = arg
  } else if ( type === 'function' ) {
    content = JSON.stringify(
      functionToString( arg )
    )
  }

  return {
    type: type,
    content: content
  }
}
