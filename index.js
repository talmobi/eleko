const fs = require( 'fs' )
const path = require( 'path' )
const url = require( 'url' )

const eeto = require( 'eeto' )

const nozombie = require( 'nozombie' )
const functionToString = require( 'function-to-string' )
const pf = require( 'parse-function' )()

const { serializeError, deserializeError } = require( 'serialize-error' )

const stdioipc = require( './stdio-ipc.js' )

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

const verbosity = (
  _envs.debug ? 10 : _envs.verbose
)

function log ( level, message ) {
  if ( level > verbosity ) return
  console.log( message )
}

process.on( 'uncaughtException', function ( err ) {
  console.log( err )
  process.exit()
} )
process.on( 'exit', onExit )

function onExit ( err ) {
  if ( onExit.done ) return
  onExit.done = true
  log( 1, 'eleko exited' )
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

function launch ( launchOptions )
{
  const _nz = nozombie()

  return new Promise( function ( browserResolve, browserReject ) {
    // path to electron executable in node context
    const _electron = require( 'electron' )

    if ( typeof _electron !== 'string' ) {
      log( 1, 'not a string' )
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

    const browser = eeto()
    browser._pages = {}

    const _env = Object.assign( {}, process.env, { launched_with_eleko: true } )
    const spawn = _childProcess.spawn( _electron, [ filepath ], { stdio: 'pipe', shell: false, env: _env } )
    _nz.add( spawn.pid )
    browser.spawn = spawn

    const ipc = stdioipc.create( spawn.stdout, spawn.stdin )
    ipc.emit( 'ready' )
    ipc.on( 'log', function ( log ) {
      if ( browser.silent ) return
      console.log( log )
    } )

    let _heartbeatTimeout = setTimeout( pulseHeartbeat, 0 ) // start heartbeats
    function pulseHeartbeat() {
      const json = { type: 'heartbeat' }
      ipc.send( json )
      _heartbeatTimeout = setTimeout( pulseHeartbeat, 1000 )
    }

    ipc.on( 'promise', function ( p ) {
      log( 2, 'ipc:promise ' + p.data.type )

      const data = p.data

      // console.log( data )

      switch ( data.type ) {
        case 'page:onrequest':
          {
            const pageId = data.pageId
            const details = data.details

            const page = browser._pages[ pageId ]
            if ( page && page.status === 'OK' ) {
              function callback ( err, data ) {
                if ( callback.done ) return
                callback.done = true

                log( 2, 'page:onrequest:callback' )
                if ( err ) return p.reject( err )
                return p.resolve( data )
              }

              if ( page.onrequest ) {
                const req = details
                req.abort = function () {
                  log( 2, 'abort' )
                  callback( undefined, true )
                }
                req.continue = function () {
                 log( 2, 'continue' )
                  callback( undefined, false )
                }

                return page.onrequest( req )
              } else {
                return p.resolve()
              }
            }
          }
          break
      }

      return p.resolve()
    } )

    browser.newPage = function ( options ) {
      return new Promise( async function ( resolve, reject ) {
        const evt = { type: 'newPage', content: options }

        let pageId
        try {
          pageId = await ipc.promise( evt )
        } catch ( err ) {
          return reject( err )
        }
        log( 1, 'pageId: ' + pageId )

        const page = {
          id: pageId,
          queue: [],
          queueInProgress: false,
          _timeouts: [],
          status: 'OK'
        }
        browser._pages[ page.id ] = page

        page._queue_tick = async function page_queue_tick () {
          log( 1, 'page._queue_tick' )
          const queue = page.queue

          if ( !page.queueInProgress && queue.length > 0 ) {
            log( 1, 'queueing next' )
            page.queueInProgress = true

            // get ( and remove ) first item from queue
            const q = queue.shift()

            function done () {
              page.queueInProgress = false
              setTimeout( page._queue_tick, 0 )
            }

            try {
              const r = await ipc.promise( q.evt )
              q.callback( undefined, r )
            } catch ( err ) {
              q.callback( err )
            }

            setTimeout( done, 0 )
          } else {
            log( 1, 'queue already in progress' )
          }
        }

        page.goto = function page_goto ( url ) {
          log( 1, 'api.page.goto' )

          return new Promise( async function ( resolve, reject ) {
            const evt = { type: 'page:goto', content: { url: url, id: page.id } }
            const queue = page.queue

            // reset queue ( page.goto reloads current page and
            // resets queue because queued up events most likely
            // won't make sense anymore )
            while ( queue.length > 0 ) {
              const q = queue.shift()
              q.callback( 'error: interrupted by parallel page.goto call' )
            }

            queue.push( {
              evt: evt,
              callback: function q_callback ( err, data ) {
                if ( q_callback.done ) return
                q_callback.done = true
                log( 1, 'queue page:goto callback' )
                if ( err ) return reject( err )
                resolve( data )
              }
            } )

            page._queue_tick()
          } )
        }

        page.evaluate = function page_evaluate ( fn, ...args ) {
          log( 1, 'api.page.evaluate' )

          const content = {
            fn: pf.parse( fn ),
            args: args,
            id: page.id
          }

          return new Promise( async function ( resolve, reject ) {
            const evt = { type: 'page:evaluate', content: content }
            const queue = page.queue

            queue.push( {
              evt: evt,
              callback: function q_callback ( err, data ) {
                if ( q_callback.done ) return
                q_callback.done = true
                log( 1, 'queue page:evaluate callback' )
                if ( err ) return reject( err )
                resolve( data )
              }
            } )

            page._queue_tick()
          } )
        }

        page.waitFor = function page_waitFor ( query, ...args ) {
          log( 1, 'api.page.waitFor' )

          let opts = {}
          if ( typeof query === 'object' ) {
            opts = query
            query = args[ 0 ]
            args = args.slice( 1 )
          }

          const polling = Number( opts.polling ) || POLL_INTERVAL

          if ( typeof query === 'string' ) {
            function fn ( querySelector ) {
              return document.querySelector( querySelector )
            }
            return page.waitFor( opts, fn, query )
          }

          return new Promise( async function ( resolve, reject ) {
            if ( typeof query === 'number' ) {
              const t = setTimeout( resolve, query )
              page._timeouts.push( t )
            } else if ( typeof query === 'function' ) {
              let _tick_timeout

              function finish ( err ) {
                if ( finish.done ) return
                finish.done = true

                clearTimeout( _wait_timeout )
                clearTimeout( _tick_timeout  )

                if ( err ) return reject( err )
                resolve()
              }

              const _wait_timeout = setTimeout( function () {
                finish( 'error: waitFor timed out (over ' + WAITFOR_TIMEOUT_TIME + ' ms)' )
              }, WAITFOR_TIMEOUT_TIME )
              page._timeouts.push( _wait_timeout )

              async function tick () {
                try {
                  const done = await page.evaluate( query, args )
                  if ( done ) return finish()
                } catch ( err ) {
                  return finish( err )
                }

                // wait polling interval and try again
                clearTimeout( _tick_timeout )
                _tick_timeout = setTimeout( tick, polling )
                page._timeouts.push( _tick_timeout )
              }
            } else {
              throw new Error( 'error: unknown page.waitFor arguments' )
            }
          } )
        }

        page.close = function page_close () {
          log( 1, 'api.page.close' )

          return new Promise( async function ( resolve, reject ) {
            const evt = { type: 'page:close', content: { id: page.id } }
            const queue = page.queue

            // reset queue ( because queued up events most likely
            // won't make sense anymore )
            while ( queue.length > 0 ) {
              const q = queue.shift()
              q.callback( 'error: interrupted by parallel page.close call' )
            }

            queue.push( {
              evt: evt,
              callback: function q_callback ( err, data ) {
                if ( q_callback.done ) return
                q_callback.done = true
                log( 1, 'queue page:close callback' )
                if ( err ) return reject( err )
                page.status = 'closed'
                resolve( data )
              }
            } )

            page._queue_tick()
          } )
        }

        resolve( page )
      } )
    }

    spawn.on( 'close', function ( code ) {
      clearTimeout( _heartbeatTimeout )
      log( 1, 'electron spawn exited, code: ' + code )
      _nz.kill()

      browser.emit( 'exit', code )
      browser.emit( 'close', code )
    } )

    browserResolve( browser )
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
    log( 1, ' === uncaughtException === ' )

    try {
      app.quit()
      log( 1, 'exited electron app' )
    } catch ( err ) {
      /* ignore */
    }

    log( 1, error )

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
      log( 1, 'pollReadyState' )

      if ( app.isReady() ) {
        onReady()
      } else {
        setTimeout( pollReadyState, 33 )
      }
    }

    function onReady () {
      log( 1, 'onReady' )

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
        log( 1, 'finish' )
        if ( _done ) {
          // we already timed out and yet now the window is ready,
          // should rarely happen
          log( 1, 'warning: launch finished but was timed out earlier (launch timeout too short?)' )
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

  let _timeout

  return new Promise ( function ( resolve, reject ) {
    function cleanup () {
      clearTimeout( _timeout )
      reject( 'cleanup' )
    }

    const off = api.once( 'pregoto', function () {
      cleanup()
    } )

    if ( typeof query === 'number' ) {
      _timeout = setTimeout( function () {
        off()
        log( 1, ' === waitFor:done (number) === ' )
        resolve()
      }, query )
      return
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
      log( 1, ' === waitFor:callback === ' )

      if ( result ) {
        log( 1, ' === waitFor:done (function) === ' )
        off() // no need to cleanup anymore
        return resolve()
      }

      const ms = Number( opts.polling ) || POLL_INTERVAL

      _timeout = setTimeout( next, ms )
    }

    next()

    async function next () {
      log( 1, ' === waitFor:next === ' )

      const now = Date.now()
      const delta = ( now - startTime )
      if ( delta > WAITFOR_TIMEOUT_TIME ) {
        return reject( 'error: timed out waitFor' )
      }

      try {
        log( 1, ' === waitFor:executeJavaScript === ' )
        const r = await mainWindow.webContents.executeJavaScript(
          fnString,
          true
        )
        callback( r )
      } catch ( err ) {
        log( 1, ' === waitFor:reject === ' )
        reject( err )
      }
    }
  } )
}

function goto ( mainWindow, url )
{
  log( 1, ' === goto === ' )
  log( 1, 'url: ' + url )

  api.emit( 'pregoto' )

  return new Promise( async function ( resolve, reject ) {
    setTimeout( startLoading, 1 )
    function startLoading () {
      log( 1, ' === goto:startLoading === ' )

      setTimeout( async function () {
        log( 1, ' === goto:document.location.href === ' )
        // mainWindow.webContents.loadURL( url )
        try {
          const r = await evaluate( mainWindow, function ( url ) {
            document.location.href = url
          }, url )

          log( 1, ' === goto:document.location.href:after === ' )
        } catch ( err ) {
          reject( err )
        }
      }, 1 )

      mainWindow.webContents.once( 'dom-ready', function () {
        log( 1, ' === goto:dom-ready === ' )
        log( 1, ' === goto:done === ' )
        resolve()
      } )
    }

    /*
    try {
      if ( !mainWindow.webContents.getURL() ) {
        await mainWindow.webContents.loadURL( 'about:blank' )
      }


      log( 1, ' === goto: waiting document.location 1 === ' )
      // await waitFor( mainWindow, { polling: 100 }, function () {
      //   return document.location && document.location.href && document.location.href === 'about:blank'
      // } )

      mainWindow.webContents.stop()
      log( 1, ' === goto: new url === ' )
      await evaluate( mainWindow, function ( url ) {
        console.log( 'new url: ' + url )
        document.location.href = url
      }, url )

      await new Promise( function ( resolve ) {
        setTimeout( resolve, 5000 )
      } )

      await new Promise( function ( resolve ) {
        tick()
        function tick () {
          log( 1, ' === goto:tick ===' )
          const isLoading = mainWindow.webContents.isLoading()

          if ( isLoading ) {
            setTimeout( tick, 200 )
          } else {
            log( 1, ' === goto:tick:done ===' )
            resolve()
          }
        }
      } )


      log( 1, ' === goto: waiting document.location 2 === ' )
      // TODO fix waitfor breaking after goto
      // await waitFor( mainWindow, { polling: 250 }, function () {
      //   return true
      // } )

      log( 1, ' === goto:done === ' )
      resolve()
    } catch ( err ) {
      reject( err )
    }
    */
  } )
}

function evaluate ( mainWindow, fn, ...args )
{
  log( 1, ' === evaluate === ' )

  const fnString = parseFunction( fn, args )

  return new Promise( async function ( resolve, reject ) {
    try {
      const r = await mainWindow.webContents.executeJavaScript(
        fnString,
        true
      )
      resolve( r )
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

  log( 1, ' === parseFunction begin === ' )
  if ( wrapped.length < 100 ) {
    log( 1, wrapped )
  } else {
    log( 1, wrapped.slice( 0, 85 ) + '...' )
  }
  log( 1, ' === parseFunction end === ' )

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

      // special cases to always allow
      if ( url.indexOf( 'devtools' ) === 0 ) {
        return callback( { cancel: false } )
      }
      if ( url.indexOf( 'about:blank' ) === 0 ) {
        return callback( { cancel: false } )
      }
      if (
        url.indexOf( 'http' ) !== 0 &&
        url.indexOf( 'file' ) !== 0
      ) {
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
