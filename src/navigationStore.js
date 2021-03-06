import { observable, action, autorunAsync } from 'mobx';
import { NavigationActions } from 'react-navigation';
import * as ActionConst from './ActionConst';
import { OnEnter, OnExit } from './Util';

export const actionMap = {
  [ActionConst.JUMP]: 'jump',
  [ActionConst.PUSH]: 'push',
  [ActionConst.REPLACE]: 'replace',
  [ActionConst.BACK]: 'pop',
  [ActionConst.BACK_ACTION]: 'pop',
  [ActionConst.POP_AND_REPLACE]: 'pop',
  [ActionConst.POP_TO]: 'popTo',
  [ActionConst.REFRESH]: 'refresh',
  [ActionConst.RESET]: 'reset',
  [ActionConst.PUSH_OR_POP]: 'push',
  [ActionConst.POP_AND_PUSH]: 'popAndPush',
};

export const supportedActions = {
  [ActionConst.PUSH]: NavigationActions.NAVIGATE,
  [ActionConst.JUMP]: NavigationActions.NAVIGATE,
  [ActionConst.BACK]: NavigationActions.BACK,
  [ActionConst.REFRESH]: NavigationActions.BACK,
  [ActionConst.RESET]: NavigationActions.RESET,
  [ActionConst.REPLACE]: NavigationActions.RESET,
};
function filterParam(data) {
  if (data.toString() !== '[object Object]') {
    return { data };
  }
  const proto = (data || {}).constructor.name;
  // avoid passing React Native parameters
  if (!data || (proto !== 'Object')) {
    return {};
  }
  return data;
}

function uniteParams(routeName, params) {
  let res = {};
  for (const param of params) {
    if (param) {
      res = { ...res, ...filterParam(param) };
    }
  }
  res.routeName = routeName;
  return res;
}

const createAction = (type: string) => (payload: Object = {}) => ({
  type,
  ...payload,
});


class NavigationStore {
  _router = null;
  states = {};
  reducer = null;
  _state;
  @observable currentScene = '';
  @observable prevScene = '';
  @observable currentParams;
  @observable _onEnterHandlerExecuted = false;
  @observable _onExitHandlerExecuted = false;

  get state() {
    const scene = this.currentScene;// eslint-disable-line no-unused-vars
    const params = this.currentParams;// eslint-disable-line no-unused-vars
    return this._state;
  }

  set router(router) {
    this._router = router;
    this.dispatch(NavigationActions.init());
  }
  get router() {
    return this._router;
  }

  constructor() {
    const defaultSuccess = () => {};
    const defaultFailure = () => {};

    autorunAsync(async () => {
      try {
        if (this.prevScene && this.currentScene !== this.prevScene && !this._onExitHandlerExecuted) {
          // call onExit handler
          this._onExitHandlerExecuted = true;
          const handler = this[this.prevScene + OnExit];
          if (handler) {
            try {
              const res = handler();
              if (res instanceof Promise) {
                res.then(defaultSuccess, defaultFailure);
              }
            } catch (e) {
              console.error('Error during onExit handler:', e);
            }
          }
        }
        if (this.currentScene && this.currentScene !== this.prevScene && this.states[this.currentScene] && !this._onEnterHandlerExecuted) {
          const handler = this[this.currentScene + OnEnter];
          this._onEnterHandlerExecuted = true;
          const success = this.states[this.currentScene].success || defaultSuccess;
          const failure = this.states[this.currentScene].failure || defaultFailure;
          // call onEnter handler
          if (handler) {
            try {
              const params = this.currentState().params;
              const res = await handler(params);
              if (res) {
                success(res);
              } else {
                failure();
              }
            } catch (e) {
              failure({ error: e });
            }
          }
        }
      } catch (e) {
        console.error(`Error handling:${e}`);
      }
    });
  }

  nextState = (state, cmd) => (this.reducer ? this.reducer(state, cmd) : this._router.getStateForAction(cmd, state));

  dispatch = (cmd, type, params) => {
    this.setState(this.nextState(this.state, cmd), type, params);
  };

  @action setState = (newState, type, params) => {
    // don't allow null state
    if (!newState) {
      return;
    }
    const state = this.currentState(newState);
    if (type === ActionConst.JUMP && state.routeName === this.currentScene) {
      return;
    }
    this._state = newState;
    // run 'blur' event
    if (this.reducer) {
      const overridenState = this.reducer(newState, { type: ActionConst.BLUR, routeName: this.prevScene });
      if (overridenState) {
        this._state = overridenState;
      }
    }
    this.prevScene = this.currentScene;
    this._onExitHandlerExecuted = false;
    this._onEnterHandlerExecuted = false;
    this.currentScene = state.routeName;
    this.currentParams = state.params;
    if (type === ActionConst.JUMP && params) {
      this.refresh(params);
    }
    // run 'focus' event
    if (this.reducer) {
      const overridenState = this.reducer(newState, { type: ActionConst.FOCUS, routeName: this.currentScene, params: state.params });
      if (overridenState) {
        this._state = overridenState;
      }
    }
  };

  execute = (actionType, routeName, ...params) => {
    const res = uniteParams(routeName, params);
    const overridenType = res.type || actionType;
    const type = actionMap[overridenType] || overridenType;
    this[type](routeName, res);
  };

  run = (type = ActionConst.PUSH, routeName, actions = {}, ...params) => {
    const res = uniteParams(routeName, params);
    if (supportedActions[type]) {
      this.dispatch(createAction(supportedActions[type])({ routeName, ...actions, params: res }), type, res);
    } else {
      if (type === ActionConst.POP_TO) {
        let nextScene = '';
        let newState = this._state;
        let currentState = this._state;
        const currentScene = this.currentScene;
        while (nextScene !== currentScene && newState && nextScene !== routeName) {
          newState = this.nextState(currentState, NavigationActions.back());
          if (newState) {
            nextScene = this.currentState(newState).routeName;
            if (nextScene !== routeName) {
              currentState = newState;
            }
          }
        }
        if (nextScene === routeName) {
          this.setState(newState);
        }
      } else if (type === ActionConst.POP_AND_PUSH) {
        this.pop();
        this.push(routeName, ...params);
      }
      // pass to reducer to notify
      if (this.reducer) {
        this.setState(this.reducer(this.state, { type, routeName, params: res }));
      }
    }
  };

  push = (routeName, ...params) => {
    this.run(ActionConst.PUSH, routeName, null, ...params);
  };

  jump = (routeName, ...params) => {
    this.run(ActionConst.JUMP, routeName, null, ...params);
  };

  drawerOpen = () => {
    this.dispatch(NavigationActions.navigate({ routeName: 'DrawerOpen' }));
  };

  drawerClose = () => {
    this.dispatch(NavigationActions.navigate({ routeName: 'DrawerClose' }));
  };

  currentState = (param) => {
    let state = param;
    if (!state) {
      state = this._state;
    }
    if (!state.routes) {
      return state;
    }
    return this.currentState(state.routes[state.index]);
  };

  refresh = (params) => {
    const key = this.currentState(this.state).key;
    this.dispatch(NavigationActions.setParams({ key, params }));
  };

  pop = (params = {}) => {
    const res = filterParam(params);
    this.dispatch(NavigationActions.back());
    if (res.refresh) {
      this.refresh(res.refresh);
    }
  };

  popTo = (routeName, ...params) => {
    this.run(ActionConst.POP_TO, routeName, null, ...params);
  };

  popAndPush = (routeName, ...params) => {
    this.run(ActionConst.POP_AND_PUSH, routeName, null, ...params);
  };

  replace = (routeName, ...params) => {
    const res = uniteParams(routeName, params);
    this.run(ActionConst.REPLACE, routeName, { key: routeName, index: 0, actions: [NavigationActions.navigate({
      routeName,
      params: res,
    })] });
  };

  reset = (routeName, ...params) => {
    const res = uniteParams(routeName, params);
    this.run(ActionConst.RESET, routeName, { key: null, index: 0, actions: [NavigationActions.navigate({
      routeName,
      params: res,
    })] });
  };
}


export default new NavigationStore();
