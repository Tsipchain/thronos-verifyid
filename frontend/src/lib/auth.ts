import axios, { AxiosInstance } from 'axios';
import { getAPIBaseURL } from './config';

const TOKEN_KEY = 'auth_token';

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY);
export const setAuthToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearAuthToken = () => localStorage.removeItem(TOKEN_KEY);

class RPApi {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((config) => {
      const token = getAuthToken();
      if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          clearAuthToken();
        }
        return Promise.reject(error);
      }
    );
  }

  private getBaseURL() {
    return getAPIBaseURL();
  }

  async getCurrentUser() {
    try {
      const response = await this.client.get(
        `${this.getBaseURL()}/api/v1/auth/me`
      );
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        return null;
      }
      throw new Error(
        error.response?.data?.detail || 'Failed to get user info'
      );
    }
  }

  async login(email: string, password: string) {
    try {
      const response = await this.client.post(
        `${this.getBaseURL()}/api/v1/auth/local/login`,
        { email, password }
      );
      setAuthToken(response.data.token);
    } catch (error) {
      throw new Error(
        error.response?.data?.detail || 'Failed to login'
      );
    }
  }

  async register(email: string, password: string, name?: string) {
    try {
      const response = await this.client.post(
        `${this.getBaseURL()}/api/v1/auth/local/register`,
        { email, password, name }
      );
      setAuthToken(response.data.token);
    } catch (error) {
      throw new Error(
        error.response?.data?.detail || 'Failed to register'
      );
    }
  }

  async logout() {
    try {
      clearAuthToken();
    } catch (error) {
      throw new Error(error.response?.data?.detail || 'Failed to logout');
    }
  }
}

export const authApi = new RPApi();
